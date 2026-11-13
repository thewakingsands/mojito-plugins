// Copyright (c) FFCafe. Licensed under AGPL-3.0-only.
import type {
  CombatantState,
  GameTopics,
  Json,
  PlayerState,
  PluginContext,
  Sample,
  SessionSnapshot,
  SourceMeta,
  Subscription,
} from '@ffcafe/mojito-plugin-sdk'
import { asJson } from '../protocol.js'
import { EurekaTracker } from './eureka.js'
import type { FateObservation } from './eureka-types.js'
import { HuntTracker } from './hunts.js'
import { navigationState } from './navigation.js'
import type { ExplorationCatalog, ExplorationContext } from './types.js'

interface Options {
  context: PluginContext
  session(): SessionSnapshot
  catalog(): ExplorationCatalog | null
  catalogRevision(): number
  publish(type: string, content: Json): void
  zoneChanged?(sequence: number): void
  disconnected?(): void
}

const sessionKey = (session: SessionSnapshot) =>
  `${session.sessionId}:${session.characterGeneration}:${session.clock.generation}:${session.clock.source}:${session.state}:${session.login}`

/** One collector per worker. View lifetime never controls observation lifetime. */
export class ExplorationService {
  private readonly hunts = new HuntTracker()
  private readonly eureka = new EurekaTracker()
  private recentFates: { observation: FateObservation; requiredZoneSeq: number }[] = []
  private target: { itemId: number; spotIndex: number } | null = null
  private player: PlayerState | null = null
  private entities: CombatantState[] | null = null
  private territoryId: number | null = null
  private expectedTerritory: number | null = null
  private zoneSample: Sample<GameTopics['zone']> | null = null
  private zoneEpoch = 0
  private boundaryAt: number | null = null
  private boundarySeq = -1
  private generation = 0
  private key = ''
  private controller = new AbortController()
  private subscriptions: Subscription[] = []
  private interval: ReturnType<typeof setInterval> | undefined
  private playerBusy = false
  private entitiesBusy = false
  private eventReady = false
  private zoneReady = false
  private ticks = 0
  private retryTicks = 0
  private stopped = true
  private readonly published = new Map<string, string>()

  constructor(private readonly options: Options) {}

  start() {
    if (!this.stopped) return
    this.stopped = false
    this.key = sessionKey(this.options.session())
    this.connect()
    this.interval = setInterval(() => this.tick(), 250)
    this.tick()
  }

  private granted(name: string) {
    return this.options.context.capabilities.get()[name]?.state === 'available'
  }

  private enabled() {
    const session = this.options.session()
    return (
      !this.stopped &&
      session.state !== 'idle' &&
      session.login !== 'logged-out' &&
      this.granted('game.read') &&
      this.granted('events.read')
    )
  }

  private sourceMatches(meta: SourceMeta) {
    const session = this.options.session()
    return (
      meta.sessionId === session.sessionId &&
      meta.characterGeneration === session.characterGeneration &&
      meta.clockGeneration === session.clock.generation &&
      meta.source === session.state
    )
  }

  private context(): ExplorationContext {
    const session = this.options.session()
    const clock = this.options.context.clock.state()
    return {
      sessionId: session.sessionId,
      characterGeneration: session.characterGeneration,
      clockGeneration: clock.generation,
      zoneEpoch: this.zoneEpoch,
      catalogRevision: this.options.catalogRevision(),
      territoryId: this.territoryId,
      clock,
    }
  }

  private clearObservations(preserveFates = false) {
    if (!preserveFates) this.recentFates = []
    this.zoneEpoch++
    this.player = null
    this.entities = null
    this.hunts.reset()
    this.eureka.reset()
  }

  private disconnect() {
    this.options.disconnected?.()
    this.generation++
    this.controller.abort()
    this.controller = new AbortController()
    for (const subscription of this.subscriptions.splice(0)) subscription.dispose()
    this.eventReady = this.zoneReady = false
    this.territoryId = this.expectedTerritory = null
    this.zoneSample = null
    this.boundarySeq = -1
    this.boundaryAt = this.options.context.clock.now()
    this.clearObservations()
  }

  reset(keepTarget = false) {
    if (!keepTarget) this.target = null
    this.disconnect()
    this.published.clear()
    this.key = sessionKey(this.options.session())
    if (!this.stopped) {
      this.connect()
      this.publishAll()
    }
  }

  private connect() {
    if (!this.enabled() || this.subscriptions.length) return
    const { context } = this.options
    const captured = this.generation
    const signal = AbortSignal.any([context.signal, this.controller.signal])
    const current = () => !this.stopped && captured === this.generation && !signal.aborted
    const fail = () => {
      if (!current()) return
      this.disconnect()
      this.retryTicks = 4
      this.publishAll()
    }
    const track = (subscription: Subscription, ready: () => void) => {
      this.subscriptions.push(subscription)
      void subscription.ready.then(() => {
        if (current()) {
          ready()
          this.confirmZone()
          this.publishAll()
        }
      }, fail)
      void subscription.closed.then(fail)
    }
    try {
      track(
        context.events.subscribe(
          'zoneChanged',
          (batch) => {
            if (!current()) return
            if (!batch.complete) return fail()
            for (const sample of batch.items) {
              if (
                !this.sourceMatches(sample.meta) ||
                sample.meta.timeBase !== context.clock.state().base ||
                !Number.isFinite(sample.meta.observedAt)
              )
                continue
              const event = sample.value
              if (event.type !== 'zoneChanged') continue
              this.clearObservations(true)
              this.territoryId = null
              this.expectedTerritory = event.data.territoryTypeId
              this.boundaryAt = sample.meta.observedAt
              this.boundarySeq = event.packet.seq
              this.options.zoneChanged?.(this.boundarySeq)
              this.recentFates = this.recentFates.filter(
                ({ observation }) =>
                  observation.packetSeq > this.boundarySeq && observation.timestamp >= sample.meta.observedAt,
              )
              this.confirmZone()
            }
            this.publishAll()
          },
          { signal },
        ),
        () => {
          this.eventReady = true
        },
      )
      // Zone sampling confirms the structured boundary; it never creates another one.
      const min = context.limits.values['game.watchMinMs']
      const max = context.limits.values['game.watchMaxMs']
      const intervalMs = Math.min(max, Math.max(min, 500))
      track(
        context.game.subscribe(
          'zone',
          (batch) => {
            if (!current()) return
            if (!batch.complete) return fail()
            for (const sample of batch.items) {
              if (!this.sourceMatches(sample.meta)) continue
              this.zoneSample = sample
              this.confirmZone()
            }
            this.publishAll()
          },
          { signal, intervalMs },
        ),
        () => {
          this.zoneReady = true
        },
      )
    } catch {
      fail()
    }
  }

  private confirmZone() {
    const field = this.zoneSample?.value.territoryType
    const confirmed =
      this.eventReady &&
      this.zoneReady &&
      field?.state === 'ok' &&
      field.timeBase === this.options.context.clock.state().base &&
      field.value > 0 &&
      (this.expectedTerritory === null ||
        (field.value === this.expectedTerritory && (this.boundaryAt === null || field.observedAt >= this.boundaryAt)))
    const wasConfirmed = this.territoryId !== null
    this.territoryId = confirmed ? field.value : null
    if (confirmed && this.expectedTerritory === null) this.expectedTerritory = field.value
    if (!confirmed) this.player = this.entities = null
    // Packet and structured-event streams may flush in either order.
    if (confirmed && !wasConfirmed)
      for (const { observation, requiredZoneSeq } of this.recentFates) {
        if (requiredZoneSeq <= this.boundarySeq) this.eureka.observe(observation)
      }
  }

  treasure(itemId: number, spotIndex: number) {
    if (itemId === 0) {
      this.target = null
      this.publishNavigation()
      return
    }
    if (!Number.isSafeInteger(itemId) || itemId <= 0 || !Number.isSafeInteger(spotIndex) || spotIndex < 0) return
    this.target = { itemId, spotIndex }
    this.publishNavigation()
  }

  observeFate(observation: FateObservation, requiredZoneSeq = -1) {
    if (!this.enabled() || !this.granted('packets.read')) return
    const clock = this.options.context.clock.state()
    if (
      clock.now === null ||
      clock.base === null ||
      clock.source !== this.options.session().state ||
      clock.generation !== this.options.session().clock.generation ||
      !Number.isFinite(observation.timestamp) ||
      observation.timestamp > clock.now ||
      (this.boundaryAt !== null && observation.timestamp < this.boundaryAt)
    )
      return
    if (observation.packetSeq <= this.boundarySeq) return
    this.recentFates.push({ observation, requiredZoneSeq })
    if (this.recentFates.length > 256) this.recentFates.shift()
    if (this.territoryId !== null && requiredZoneSeq <= this.boundarySeq) this.eureka.observe(observation)
    this.publishEureka()
  }

  private publish(type: string, value: unknown) {
    if (this.stopped) return
    const content = asJson(value)
    const key = JSON.stringify(content)
    if (this.published.get(type) === key) return
    this.published.set(type, key)
    this.options.publish(type, content)
  }

  private publishNavigation() {
    this.publish(
      'NavigationState',
      navigationState(this.context(), this.options.catalog(), this.target, this.player, this.boundaryAt),
    )
  }

  private publishHunts() {
    this.publish(
      'HuntState',
      this.hunts.update(this.context(), this.options.catalog(), this.entities, this.player, this.boundaryAt),
    )
  }

  private publishEureka() {
    this.publish(
      'EurekaState',
      this.eureka.state({
        context: this.context(),
        catalog: this.territoryId === null ? null : (this.options.catalog()?.eureka[this.territoryId] ?? null),
        available: this.enabled() && this.eventReady && this.zoneReady && this.granted('packets.read'),
      }),
    )
  }

  private publishAll() {
    this.publishNavigation()
    this.publishHunts()
    this.publishEureka()
  }

  private tick() {
    if (this.stopped) return
    const key = sessionKey(this.options.session())
    if (this.key !== key) this.reset()
    if (this.options.context.clock.state().generation !== this.options.session().clock.generation) {
      this.disconnect()
      this.publishAll()
      return
    }
    if (this.retryTicks > 0) this.retryTicks--
    else this.connect()
    if (!this.enabled()) {
      this.player = null
      this.entities = null
      this.territoryId = null
    }
    const captured = this.generation
    const capturedZone = this.zoneEpoch
    const signal = AbortSignal.any([this.options.context.signal, this.controller.signal])
    const current = () =>
      !this.stopped && captured === this.generation && capturedZone === this.zoneEpoch && !signal.aborted
    if (this.enabled() && this.territoryId !== null) {
      if (!this.playerBusy) {
        this.playerBusy = true
        void this.options.context.game
          .getPlayer({ fields: ['actorId', 'position', 'rotation'] }, { signal })
          .then(
            (sample) => {
              if (current()) this.player = this.sourceMatches(sample.meta) ? sample.value : null
            },
            () => {
              if (current()) this.player = null
            },
          )
          .finally(() => {
            this.playerBusy = false
            if (current()) this.publishNavigation()
          })
      }
      if (this.ticks % 2 === 0 && !this.entitiesBusy) {
        this.entitiesBusy = true
        void this.options.context.game
          .getCombatants(
            {
              fields: ['objectKind', 'bNpcBase', 'bNpcName', 'position', 'hpCur', 'hpMax'],
            },
            { signal },
          )
          .then(
            (sample) => {
              if (current()) this.entities = this.sourceMatches(sample.meta) ? sample.value.entities : null
            },
            () => {
              if (current()) this.entities = null
            },
          )
          .finally(() => {
            this.entitiesBusy = false
            if (current()) this.publishHunts()
          })
      }
    }
    this.publishNavigation()
    if (this.ticks % 2 === 0) this.publishHunts()
    if (this.ticks++ % 4 === 0) this.publishEureka()
  }

  dispose() {
    this.stopped = true
    if (this.interval) clearInterval(this.interval)
    this.interval = undefined
    this.disconnect()
  }
}
