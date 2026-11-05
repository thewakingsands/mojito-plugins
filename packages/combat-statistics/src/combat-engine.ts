import {
  CombatEngine,
  type CombatInput,
  type CombatOutput,
  type HitResult,
  MemoryWorld,
  type PeriodicTick as ModelTick,
  type PeriodicDefs,
  parseStatusEntries,
  type TelemetrySample,
} from '@ffcafe/mojito-combat-model'
import type { CombatantState, Sample, SourceMeta } from '@ffcafe/mojito-plugin-sdk'
import type { CombatResultEvent, GameEvent, PeriodicTick, ResultPacket } from './combat-events.js'

/** The events of the host the combat model reads */
export const MODEL_INPUTS = [
  'actionEffect',
  'actorDied',
  'zoneChanged',
  'castStarted',
  'castCancelled',
  'statusesReplaced',
  'statusSlotsChanged',
  'actorProfileChanged',
  'overTimeTick',
  'jobGaugeChanged',
  'playerStatsChanged',
] as const

/** The effect entries the model reads, by their type code */
const HIT_RESULTS = new Map<number, HitResult>([
  [3, 'damage'],
  [4, 'heal'],
  [5, 'blocked'],
  [6, 'parried'],
])
const EFFECT_ON_SOURCE = 0x80
/** The splits of these many ticks keep the packet of their tick */
const ATTRIBUTED_TICKS = 1024
/** The changes of a window go out in revisions of at most these many */
const DELTA_BATCH = 256

/** The input of the model an event of the host is, null for an event the model does not read */
export function toCombatInput(event: GameEvent, meta: SourceMeta): CombatInput | null {
  const time = event.packet?.timestamp ?? meta.observedAt
  switch (event.type) {
    case 'actionEffect': {
      const { data } = event
      return {
        type: 'effect',
        time,
        caster: data.sourceActorId,
        action: data.actionId,
        sequence: data.sequence,
        targets: data.targets.map((target, index) => ({
          id: target.targetId,
          index: target.targetIndex ?? index,
          hits: target.effects.flatMap((effect) => {
            const result = HIT_RESULTS.get(effect.typeCode)
            return result
              ? [
                  {
                    result,
                    amount: effect.rawValue,
                    critical: effect.critical,
                    direct: effect.direct,
                    bonusPercent: effect.rawBonusPercent,
                    onSource: (effect.rawFlags & EFFECT_ON_SOURCE) !== 0,
                  },
                ]
              : []
          }),
          applied: parseStatusEntries(target.rawEntries ?? []),
        })),
      }
    }
    case 'actorDied':
      return { type: 'death', time, actor: event.data.actorId }
    case 'zoneChanged':
      return { type: 'zone', time, territory: event.data.territoryTypeId, receiver: event.packet.targetActorId }
    case 'castStarted':
    case 'castCancelled':
      return { type: 'cast', time, caster: event.data.casterId, action: event.data.actionId }
    case 'statusesReplaced':
      return {
        type: 'statusList',
        time,
        holder: event.data.actorId,
        statuses: event.data.statuses.map((status) => ({ id: status.statusId, source: status.sourceActorId })),
      }
    case 'statusSlotsChanged':
      return {
        type: 'statuses',
        time,
        holder: event.data.actorId,
        slots: event.data.slots.map(({ slot, status }) => ({
          slot,
          status: status && { id: status.statusId, source: status.sourceActorId, stacks: status.param },
        })),
        changes: event.data.changes.map(({ kind, slot, statusId, sourceActorId }) => ({
          kind,
          slot,
          status: statusId,
          source: sourceActorId,
        })),
      }
    case 'actorProfileChanged':
      return { type: 'actor', time, ...event.data }
    case 'overTimeTick': {
      const { data } = event
      return {
        type: 'tick',
        time,
        target: data.targetId,
        isHeal: data.isHeal,
        status: data.statusId,
        amount: data.amount,
        source: data.sourceActorId,
      }
    }
    case 'jobGaugeChanged':
      return { type: 'gauge', time, actor: event.data.actorId, gauge: event.data.gauge }
    case 'playerStatsChanged': {
      const { actorId, criticalHit, directHit } = event.data
      return { type: 'playerStats', time, actor: actorId, criticalHit, directHit }
    }
    default:
      return null
  }
}

interface Origin {
  meta: SourceMeta
  packet: ResultPacket
}

export interface RunnerOptions {
  defs: PeriodicDefs
  /** The estimatorGeneration of the engine before, 0 for none */
  previousGeneration: number
  /** The source clock; null before it has a time */
  now(): number | null
  /** Calls back after ms of source time; the disposer cancels it */
  setTimeout(callback: () => void, ms: number): () => void
  /** Hands on the results of a deadline that passed without an input */
  drained(results: Sample<CombatResultEvent>[]): void
  /** Records how long the model took, once when the runner is disposed */
  timing(fields: { inputsP99: number; inputsMax: number; msP99: number; msMax: number }): void
}

/** The p99 of the values, the value at the 99th percentile of the sorted values */
function p99(values: readonly number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.ceil(sorted.length * 0.99) - 1]
}

/**
 * Runs the combat model of one data source: hands it the events of the host, and gives back its results as the events
 * the host sent before Plugin API 1.9.0, with their meta and packet. A tick, and the split of its damage, take those of
 * the tick; a potency sample and the split of a hit those of the effect. The revisions have no packet, and take the
 * source clock when they come.
 */
export class CombatEngineRunner {
  readonly generation: number
  private engine: CombatEngine
  private ticks = 0
  private origins = new Map<number, Origin>()
  private attributedTicks = new Map<number, Origin>()
  private lastMeta: SourceMeta | null = null
  /**
   * Relates the source clock to the packet times of the model; set by the packet that starts a wait. Packets arrive
   * later than their times say and by varying amounts, so a deadline passes on the source clock, not at the time of the
   * next packet.
   */
  private anchor: { source: number; model: number } | null = null
  private cancelTimer: (() => void) | null = null
  /** The inputs and the milliseconds the model took in each second of the source */
  private seconds = new Map<number, { inputs: number; ms: number }>()
  private disposed = false
  private telemetryEnabled = false
  private complete = new Set<number>()
  private replacements = new Map<number, string>()
  private telemetry: TelemetrySample[] = []

  setTelemetryEnabled(enabled: boolean): void {
    this.telemetryEnabled = enabled
    this.engine.setTelemetryEnabled(enabled)
    if (!enabled) this.telemetry = []
  }

  takeTelemetry(): TelemetrySample[] {
    const samples = this.telemetry
    this.telemetry = []
    return samples
  }

  clearTelemetryState(): void {
    this.complete.clear()
    this.replacements.clear()
    this.telemetry = []
  }

  private confirmStatuses(actor: number): void {
    const expected = this.replacements.get(actor)
    if (expected === undefined) return
    const actual = this.engine.world
      .getBuffs(actor)
      .map(({ id, source, stacks }) => `${id}:${source}:${stacks}`)
      .sort()
      .join(',')
    if (actual === expected) {
      this.complete.add(actor)
      this.replacements.delete(actor)
    }
  }

  constructor(private options: RunnerOptions) {
    this.generation = Math.max(options.previousGeneration + 1, Math.floor(Date.now() / 1000))
    this.engine = new CombatEngine(options.defs)
  }

  /** Starts over with the actors and their statuses as the host knows them now */
  reset(combatants: readonly CombatantState[]): void {
    this.clearTelemetryState()
    const world = new MemoryWorld()
    for (const combatant of combatants) {
      const value = <T>(field: { state: string; value?: T } | undefined) =>
        field?.state === 'ok' ? (field.value as T) : undefined
      world.handle({
        type: 'actor',
        time: 0,
        actorId: combatant.id,
        classJob: value(combatant.classJob) ?? 0,
        level: value(combatant.level) ?? 0,
        ownerId: value(combatant.ownerId) ?? null,
      })
      const statuses = value(combatant.statuses)
      if (statuses) this.complete.add(combatant.id)
      if (statuses)
        world.handle({
          type: 'statuses',
          time: 0,
          holder: combatant.id,
          slots: statuses.map((status, index) => ({
            slot: (status as { slot?: number }).slot ?? index,
            status: { id: status.statusId, source: status.sourceActorId, stacks: status.param },
          })),
          changes: [],
        })
    }
    this.cancelTimer?.()
    this.cancelTimer = null
    this.engine = new CombatEngine(this.options.defs, world)
    this.engine.setTelemetryEnabled(this.telemetryEnabled)
    this.ticks = 0
    this.origins.clear()
    this.attributedTicks.clear()
    this.anchor = null
  }

  /**
   * Hands an event of the host to the model
   * @returns The results it gave
   * @throws When the model fails; the runner is not usable then
   */
  receive(item: Sample<GameEvent>): Sample<CombatResultEvent>[] {
    if (this.disposed) return []
    if (
      this.lastMeta &&
      (this.lastMeta.sessionId !== item.meta.sessionId ||
        this.lastMeta.characterGeneration !== item.meta.characterGeneration ||
        this.lastMeta.clockGeneration !== item.meta.clockGeneration)
    )
      this.clearTelemetryState()
    this.lastMeta = item.meta
    const started = performance.now()
    const input = toCombatInput(item.value, item.meta)
    if (!input) return []
    const packet = item.value.packet
    const origin: Origin | null = packet ? { meta: item.meta, packet } : null
    // Timers may be behind the events, which come in batches
    const passed = this.drainUntil(item.meta.observedAt)
    if (packet && (!this.anchor || this.engine.nextDeadline() === null))
      this.anchor = { source: item.meta.observedAt, model: packet.timestamp }
    if (input.type === 'tick' && origin) this.origins.set(this.ticks + 1, origin)
    if (input.type === 'tick') this.ticks++
    if (input.type === 'zone') this.clearTelemetryState()
    if (item.value.type === 'statusesReplaced' && item.value.data.actorId !== null) {
      const { actorId, statuses } = item.value.data
      this.complete.delete(actorId)
      this.replacements.set(
        actorId,
        statuses
          .map((status) => `${status.statusId}:${status.sourceActorId ?? 0xe0000000}:${status.param}`)
          .sort()
          .join(','),
      )
      this.confirmStatuses(actorId)
    }
    const outputs = this.engine.handle(input)
    if (input.type === 'statuses' && input.holder !== null) this.confirmStatuses(input.holder)
    const results = [...passed, ...this.convert(outputs, origin)]
    this.measure(input.time, performance.now() - started)
    this.schedule()
    return results
  }

  /** Lets the deadline of the model pass */
  drain(): Sample<CombatResultEvent>[] {
    const due = this.engine.nextDeadline()
    if (this.disposed || due === null) return []
    const results = this.convert(this.engine.drain(due), null)
    this.schedule()
    return results
  }

  /** Lets the deadlines before the source time pass */
  private drainUntil(sourceTime: number): Sample<CombatResultEvent>[] {
    const results: Sample<CombatResultEvent>[] = []
    for (let due = this.dueOnSource(); due !== null && due <= sourceTime; due = this.dueOnSource())
      results.push(...this.convert(this.engine.drain(this.engine.nextDeadline() as number), null))
    return results
  }

  /** The source time of the next deadline of the model */
  private dueOnSource(): number | null {
    const due = this.engine.nextDeadline()
    return due === null || !this.anchor ? null : this.anchor.source + due - this.anchor.model
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.cancelTimer?.()
    this.cancelTimer = null
    const seconds = [...this.seconds.values()]
    this.options.timing({
      inputsP99: p99(seconds.map((second) => second.inputs)),
      inputsMax: Math.max(0, ...seconds.map((second) => second.inputs)),
      msP99: p99(seconds.map((second) => second.ms)),
      msMax: Math.max(0, ...seconds.map((second) => second.ms)),
    })
  }

  private measure(time: number, ms: number) {
    const key = Math.floor(time / 1000)
    const second = this.seconds.get(key) ?? { inputs: 0, ms: 0 }
    second.inputs += 1
    second.ms += ms
    this.seconds.set(key, second)
  }

  private schedule() {
    this.cancelTimer?.()
    this.cancelTimer = null
    const due = this.dueOnSource()
    if (due === null) return
    this.cancelTimer = this.options.setTimeout(
      () => {
        this.cancelTimer = null
        const results = this.drain()
        if (results.length) this.options.drained(results)
      },
      Math.max(0, due - (this.options.now() ?? due)),
    )
  }

  private tickOf(tick: ModelTick, origin: Origin): PeriodicTick {
    return { estimatorGeneration: this.generation, ...tick, occurredAt: origin.meta.observedAt }
  }

  /** The results with their meta and packet; current is the input that gave them, null for a deadline */
  private convert(outputs: readonly CombatOutput[], current: Origin | null): Sample<CombatResultEvent>[] {
    const estimatorGeneration = this.generation
    const results: Sample<CombatResultEvent>[] = []
    const now = () => this.options.now()
    for (const output of outputs) {
      switch (output.type) {
        case 'telemetrySample':
          if (current && this.complete.has(output.data.casterId) && this.complete.has(output.data.targetId))
            this.telemetry.push(output.data)
          break
        case 'periodicTick': {
          const { tickId, statusId } = output.data
          const origin = this.origins.get(tickId)
          if (origin) {
            results.push({
              meta: origin.meta,
              value: { type: 'periodicTick', packet: origin.packet, data: this.tickOf(output.data, origin) },
            })
            this.attributedTicks.set(tickId, origin)
            if (this.attributedTicks.size > ATTRIBUTED_TICKS)
              this.attributedTicks.delete(this.attributedTicks.keys().next().value as number)
          }
          if (statusId !== 0) this.origins.delete(tickId)
          break
        }
        case 'periodicRevision': {
          const known = output.data.ticks.flatMap((tick) => {
            const origin = this.origins.get(tick.tickId)
            return origin ? [{ tick, origin }] : []
          })
          if (known.length)
            results.push({
              meta: { ...known[0].origin.meta, observedAt: now() ?? known[0].origin.meta.observedAt },
              value: {
                type: 'periodicRevision',
                data: { estimatorGeneration, ticks: known.map(({ tick, origin }) => this.tickOf(tick, origin)) },
              },
            })
          for (const tick of output.data.ticks) this.origins.delete(tick.tickId)
          break
        }
        case 'damageAttributed': {
          const { origin: from } = output.data
          const origin = from.type === 'tick' ? this.attributedTicks.get(from.tickId) : current
          if (origin)
            results.push({
              meta: origin.meta,
              value: {
                type: 'damageAttributed',
                packet: origin.packet,
                data: { estimatorGeneration, ...output.data },
              },
            })
          break
        }
        case 'potencySample':
          if (current)
            results.push({
              meta: current.meta,
              value: { type: 'potencySample', packet: current.packet, data: output.data },
            })
          break
        case 'attributionRevision': {
          const last = results.at(-1)?.meta ?? this.lastMeta
          if (!last) break
          const meta = { ...last, observedAt: now() ?? last.observedAt }
          const { records } = output.data
          for (let start = 0; start < records.length; start += DELTA_BATCH)
            results.push({
              meta,
              value: {
                type: 'attributionRevision',
                data: { estimatorGeneration, records: records.slice(start, start + DELTA_BATCH) },
              },
            })
          break
        }
      }
    }
    return results
  }
}
