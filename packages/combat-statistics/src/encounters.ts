import type { Sample } from '@ffcafe/mojito-plugin-sdk'
import type { EndEncounterResult } from '@ffcafe/mojito-plugin-sdk/overlayplugin'
import type { GameEvent } from './combat-events.js'
import { HpTracker } from './hp-tracker.js'
import { Ledger, type LedgerEntry, remember, remembered, tickKey } from './ledger.js'
import type { Carry } from './log/types.js'
import { type Actor, defaults, metric, type Settings, type Summary, sourceKey } from './model.js'
import { Outcome } from './outcome.js'
import type { PresentationAnchor } from './presentation.js'
import { elapsed } from './settlement-time.js'

export interface EncounterHooks {
  started(info: { id: string; at: number }): void
  /** `afterInput` marks an end decided after the event being accepted was already applied to the fight. */
  ended(info: { id: string; reason: string; at: number; summary: Summary; afterInput: boolean }): void
}
/** An encounter that changed; its summary is computed when read, from the encounter as it is then. */
export interface ChangedEncounter {
  id: string
  ended: boolean
  summary(): Summary
}
interface Encounter {
  id: string
  source: string
  zone: number | null
  start: number
  end: number
  hostile: number
  closedAt: number | null
  closedSeq: number | null
  reason: string | null
  ledger: Ledger
  /** The ids of the damageAttributed the encounter took, by estimatorGeneration; the deltas find it by them */
  attributed: Map<number, [number, number][]>
  outcome: Outcome
}
/** The periodicTicks whose damageAttributed events may still come */
const attributionTickLimit = 1024
export class Encounters {
  config: Settings = { ...defaults }
  readonly actors = new Map<number, Actor>()
  readonly qualityReasons = new Set<string>()
  readonly completed: Encounter[] = []
  readonly hpTracker = new HpTracker()
  active: Encounter | null = null
  source: string | null = null
  zone: number | null = null
  localActorId: number | null = null
  inCombat: boolean | null = null
  private combatSeq: number | null = null
  private combatAt = -Infinity
  private snapshotAt = -Infinity
  private combatValue: boolean | null = null
  private packetSeq = -Infinity
  private bindings = new Map<string, Encounter>()
  /** Why contributionDps is unavailable for new encounters; null when the host splits the damage */
  contributionUnavailable: string | null = null
  /** The last actionEffect given to an encounter; its damageAttributed events come right after it */
  private lastEffect: { seq: number; encounter: Encounter } | null = null
  /** The encounter of each accepted periodicTick, by tickKey, for the damageAttributed of its shares */
  private attributionTicks = new Map<string, Encounter>()
  private trailing = false
  /**
   * Increases whenever a method may change an encounter, which only methods of this class do; a summary computed
   * at the same revision is still current.
   */
  private revision = 0
  /** The identities revision and the active encounter the actors were last refreshed for */
  private refreshed: { revision: number; active: Encounter | null } | null = null
  private readonly summaries = new WeakMap<Encounter, { revision: number; byMerge: Map<boolean, Summary> }>()
  constructor(
    private readonly nextId: () => string,
    private readonly changed: (encounter: ChangedEncounter, revision: boolean) => void,
    private readonly hooks?: EncounterHooks,
    /** Sees what the ledger of every encounter books */
    private readonly ledgerObserver?: (fightId: string, entry: LedgerEntry) => void,
  ) {}
  /** State that outlives a zone change; the combat log records it so a visit can be replayed on its own. */
  carry(): Carry['encounters'] {
    const finite = (value: number) => (Number.isFinite(value) ? value : null)
    return {
      localActorId: this.localActorId,
      inCombat: this.inCombat,
      combatValue: this.combatValue,
      packetSeq: finite(this.packetSeq),
      combatSeq: this.combatSeq,
      combatAt: finite(this.combatAt),
      hp: this.hpTracker.carry(),
    }
  }
  restore(value: Carry['encounters']) {
    this.revision++
    this.localActorId = value.localActorId
    this.inCombat = value.inCombat
    this.combatValue = value.combatValue
    this.packetSeq = value.packetSeq ?? -Infinity
    this.combatSeq = value.combatSeq
    this.combatAt = value.combatAt ?? -Infinity
    this.hpTracker.restore(value.hp ?? [])
  }
  /** @param revision The revision of the actors; the same revision for the same active encounter changes nothing */
  updateActors(actors: Map<number, Actor>, revision?: number) {
    if (revision !== undefined && this.refreshed?.revision === revision && this.refreshed.active === this.active) return
    this.refreshed = revision === undefined ? null : { revision, active: this.active }
    this.revision++
    this.actors.clear()
    for (const [id, actor] of actors) this.actors.set(id, actor)
    this.active?.ledger.refresh(actors)
  }
  /** Snapshots initialize state or invalidate it, but never synthesize a transition. */
  syncCombat(value: boolean | null, at: number, now: number) {
    this.revision++
    if (at < this.snapshotAt || at <= this.combatAt) return
    this.snapshotAt = at
    if (this.combatSeq === null || value === null) {
      this.inCombat = value
      if (value === null) this.combatValue = null
      this.advance(now)
    }
  }
  /** Whether syncCombat with these arguments would change the combat state, rather than only the snapshot time */
  syncChanges(value: boolean | null, at: number): boolean {
    if (at < this.snapshotAt || at <= this.combatAt) return false
    if (this.combatSeq !== null && value !== null) return false
    return this.inCombat !== value || (value === null && this.combatValue !== null)
  }
  resetCombat(at: number) {
    this.revision++
    this.inCombat = null
    this.combatSeq = null
    this.combatValue = null
    this.combatAt = at
    this.snapshotAt = at
    this.packetSeq = -Infinity
  }
  deadline(): number | null {
    return this.active && this.config.mode === 'auto' && this.inCombat !== true
      ? this.active.hostile + this.config.quietSeconds * 1000 + 1
      : null
  }
  advance(now: number) {
    this.revision++
    const deadline = this.deadline()
    if (this.active && deadline !== null && now >= deadline)
      this.finish('quiet', this.active.hostile + this.config.quietSeconds * 1000)
  }
  private create(at: number) {
    const encounter: Encounter = {
      id: this.nextId(),
      source: this.source!,
      zone: this.zone,
      start: at,
      end: at,
      hostile: at,
      closedAt: null,
      closedSeq: null,
      reason: null,
      ledger: new Ledger(new Map(this.actors)),
      attributed: new Map(),
      outcome: new Outcome(),
    }
    encounter.ledger.contributionUnavailable = this.contributionUnavailable
    const observer = this.ledgerObserver
    if (observer) encounter.ledger.observer = (entry) => observer(encounter.id, entry)
    for (const reason of this.qualityReasons) encounter.ledger.quality.add(reason)
    this.active = encounter
    this.hooks?.started({ id: encounter.id, at })
    return encounter
  }
  private timing(encounter: Encounter) {
    const time = encounter.ledger.settlement()
    return { durationMs: elapsed(time), lastFactSourceAt: time?.last ?? null, time }
  }
  presentationAnchor(): PresentationAnchor | null {
    const encounter = this.active
    if (!encounter) return null
    const { durationMs, lastFactSourceAt } = this.timing(encounter)
    if (
      lastFactSourceAt === null ||
      !Number.isFinite(durationMs) ||
      durationMs < 0 ||
      !Number.isFinite(lastFactSourceAt)
    )
      return null
    return { encounterId: encounter.id, source: encounter.source, factDurationMs: durationMs, lastFactSourceAt }
  }
  /** The summary is shared until the encounters change, so callers must not modify it. */
  snapshot(encounter = this.active, mergePets = this.config.mergePets): Summary | null {
    if (!encounter) return null
    let cached = this.summaries.get(encounter)
    if (cached?.revision !== this.revision) {
      cached = { revision: this.revision, byMerge: new Map() }
      this.summaries.set(encounter, cached)
    }
    let summary = cached.byMerge.get(mergePets)
    if (!summary) {
      summary = this.summarize(encounter, mergePets)
      cached.byMerge.set(mergePets, summary)
    }
    return summary
  }
  private summarize(encounter: Encounter, mergePets: boolean): Summary {
    const { durationMs, time } = this.timing(encounter)
    const rows = encounter.ledger.summary(encounter.start, encounter.end, mergePets, durationMs)
    const damage = rows.reduce((sum, row) => sum + row.totals.damage, 0),
      healing = rows.reduce((sum, row) => sum + row.totals.healing, 0)
    const quality = [...encounter.ledger.quality]
    const metricQuality = rows.some((row) => row.metrics.damage.quality === 'partial')
      ? 'partial'
      : rows.some((row) => row.estimatedDamage > 0)
        ? 'estimated'
        : 'observed'
    const outcome = encounter.outcome.result(rows, encounter.ledger.actors.values(), encounter.closedAt !== null)
    return {
      schemaVersion: 1,
      title: outcome.mainEnemy?.name ?? null,
      durationMs,
      id: encounter.id,
      source: encounter.source,
      zone: encounter.zone,
      startAt: time?.first ?? encounter.start,
      endAt: time?.last ?? encounter.start,
      lastHostileAt: encounter.hostile,
      ended: encounter.closedAt !== null,
      reason: encounter.reason,
      quality,
      diagnostics: { ...encounter.ledger.diagnostics },
      rows,
      encounterDamage: metric(damage, metricQuality),
      reportedHealing: metric(healing, rows.some((row) => row.estimatedHealing > 0) ? 'estimated' : metricQuality),
      contributionUnavailable: encounter.ledger.contributionUnavailable,
      outcome,
    }
  }
  private notify(encounter: Encounter, revision = false) {
    this.changed(
      { id: encounter.id, ended: encounter.closedAt !== null, summary: () => this.snapshot(encounter, false)! },
      revision,
    )
  }
  finish(reason: string, at: number, incomplete = false) {
    this.revision++
    const encounter = this.active
    if (!encounter) return
    encounter.closedAt = Math.max(encounter.end, at)
    encounter.closedSeq = Number.isFinite(this.packetSeq) ? this.packetSeq : null
    encounter.reason = reason
    if (incomplete) encounter.ledger.quality.add(`输入不完整：${reason}`)
    this.active = null
    this.completed.unshift(encounter)
    for (const removed of this.completed.splice(100)) {
      removed.ledger.seal()
      for (const map of [this.bindings, this.attributionTicks])
        for (const [key, owner] of map) if (owner === removed) map.delete(key)
    }
    this.notify(encounter)
    this.hooks?.ended({
      id: encounter.id,
      reason,
      at: encounter.closedAt,
      summary: this.snapshot(encounter, false)!,
      afterInput: this.trailing,
    })
  }
  boundary(reason: string, at: number) {
    this.revision++
    this.finish(reason, at, true)
    for (const encounter of this.completed) encounter.ledger.seal()
    // Sealing settles the heals, which changes the summary finish computed.
    this.revision++
    this.bindings.clear()
    this.attributionTicks.clear()
    this.lastEffect = null
    this.actors.clear()
    this.refreshed = null
    // An actor id of another source is another actor.
    this.hpTracker.clear()
    this.source = null
    this.resetCombat(at)
  }
  end(id: string, now: number): EndEncounterResult {
    this.revision++
    if (this.active?.id === id) {
      this.finish('manual', now)
      return 'ended'
    }
    if (this.active) return 'staleEncounter'
    return this.completed.some((encounter) => encounter.id === id) ? 'alreadyEnded' : 'notFound'
  }
  /** Clearing history removes pending old owners too, so a late post cannot resurrect them. */
  clearHistory() {
    this.revision++
    for (const encounter of this.completed) encounter.ledger.seal()
    this.completed.length = 0
    for (const map of [this.bindings, this.attributionTicks])
      for (const [key, owner] of map) if (owner !== this.active) map.delete(key)
  }
  /** Splits of the host: they adjust the encounter that took their damage, whether it ended or not */
  private attribution(event: GameEvent<'damageAttributed' | 'attributionRevision'>, source: string, at: number) {
    if (event.type === 'damageAttributed') {
      const { data } = event
      const { origin } = data
      const seq = event.packet?.seq ?? -1
      const encounter =
        origin.type === 'action'
          ? this.lastEffect?.seq === seq
            ? this.lastEffect.encounter
            : undefined
          : this.attributionTicks.get(tickKey({ estimatorGeneration: data.estimatorGeneration, tickId: origin.tickId }))
      if (encounter?.source !== source || remembered(encounter.attributed, data.estimatorGeneration, data.id)) return
      const adjusted =
        origin.type === 'action'
          ? encounter.ledger.attributeHit(seq, data, at)
          : encounter.ledger.attribute(
              data.actorId,
              `status:${origin.statusId}`,
              data.unattributed,
              data.contributions,
              at,
            )
      if (!adjusted) return
      remember(encounter.attributed, data.estimatorGeneration, data.id)
      this.notify(encounter, encounter.closedAt !== null)
      return
    }
    const { estimatorGeneration, records } = event.data
    const touched = new Set<Encounter>()
    for (const record of records) {
      const encounter =
        record.id !== null
          ? [this.active, ...this.completed].find(
              (item) => item?.source === source && remembered(item.attributed, estimatorGeneration, record.id!),
            )
          : record.tickId !== null
            ? this.bindings.get(tickKey({ estimatorGeneration, tickId: record.tickId }))
            : undefined
      if (!encounter || encounter.source !== source) continue
      const skill =
        record.origin.type === 'action' ? `action:${record.origin.actionId}` : `status:${record.origin.statusId}`
      if (encounter.ledger.attribute(record.actorId, skill, record.unattributed, record.contributions, at))
        touched.add(encounter)
    }
    for (const encounter of touched) this.notify(encounter, true)
  }
  accept(sample: Sample<GameEvent>, now: number) {
    this.revision++
    const source = sourceKey(sample.meta)
    if (this.source !== null && this.source !== source) this.boundary('sourceChanged', sample.meta.observedAt)
    this.source = source
    const event = sample.value
    if (event.type === 'damageAttributed' || event.type === 'attributionRevision') {
      this.attribution(event, source, sample.meta.observedAt)
      return
    }
    const seq = event.packet?.seq
    if (event.type === 'playerCombatChanged') {
      if (
        event.data.actorId !== this.localActorId ||
        seq! < this.packetSeq ||
        (this.combatSeq !== null && seq! <= this.combatSeq) ||
        sample.meta.observedAt < this.combatAt
      )
        return
      this.packetSeq = Math.max(this.packetSeq, seq!)
      this.combatSeq = seq!
      this.combatAt = sample.meta.observedAt
      this.inCombat = event.data.inCombat
      const transition = this.combatValue !== this.inCombat
      this.combatValue = this.inCombat
      if (transition && !this.inCombat && this.config.mode === 'auto')
        this.finish('outOfCombat', sample.meta.observedAt)
      return
    }
    if (seq !== undefined) this.packetSeq = Math.max(this.packetSeq, seq)
    if (event.type === 'periodicRevision') {
      const touched = new Set<Encounter>()
      for (const tick of event.data.ticks) {
        const key = tickKey(tick),
          encounter = this.bindings.get(key)
        if (encounter?.source === source && encounter.ledger.periodic(tick, true)) {
          touched.add(encounter)
          if (tick.phase === 'post') this.bindings.delete(key)
        }
      }
      for (const encounter of touched) this.notify(encounter, true)
      return
    }
    // HP neither opens nor extends an encounter; it settles the heals of an encounter that may have ended since.
    if (event.type === 'hpChanged') {
      const { actorId, hpCur, hpMax, sequence } = event.data
      if (actorId === null) return
      const before = this.hpTracker.current(actorId)
      if (sequence !== null)
        for (const encounter of [this.active, ...this.completed])
          if (
            encounter?.source === source &&
            encounter.ledger.settleHeal(sequence, actorId, before, hpCur, hpMax, sample.meta.observedAt)
          ) {
            this.notify(encounter, encounter.closedAt !== null)
            break
          }
      this.hpTracker.apply(actorId, hpCur, hpMax, event.packet.timestamp, sequence === null)
      const hp = this.hpTracker.current(actorId)!
      this.active?.outcome.health(this.actors.get(actorId), hp.hpCur, hp.hpMax)
      return
    }
    if (event.type === 'zoneChanged') {
      this.finish('zoneChanged', sample.meta.observedAt)
      this.resetCombat(sample.meta.observedAt)
      this.zone = event.data.territoryTypeId
      return
    }
    if (!['actionEffect', 'actorDied', 'periodicTick'].includes(event.type)) return
    const at = event.type === 'periodicTick' ? event.data.occurredAt : sample.meta.observedAt
    let encounter: Encounter | undefined
    if (event.type === 'periodicTick') {
      if (this.bindings.has(tickKey(event.data))) return
      const owners = this.completed.filter((item) => item.source === source && at >= item.start && at <= item.closedAt!)
      // A timestamp alone cannot place a first tick on either side of an ordered combat edge.
      if (owners.length > 1 || owners.some((item) => item.reason === 'outOfCombat' && at === item.closedAt)) return
      encounter = owners[0]
    }
    if (!encounter) {
      this.advance(at)
      encounter = this.active ?? undefined
      if (encounter && at < encounter.start) return
      if (!encounter) {
        // A tick after leaving combat belongs to no fight.
        if (event.type === 'periodicTick' && this.config.mode === 'auto' && this.inCombat === false) return
        // An old fact after a manual end must not open a duplicate encounter.
        if (
          this.completed.some(
            (item) =>
              item.source === source &&
              (at < item.closedAt! ||
                (at === item.closedAt &&
                  !(
                    event.type === 'actionEffect' &&
                    item.reason === 'outOfCombat' &&
                    item.closedSeq !== null &&
                    seq! >= item.closedSeq
                  ))),
          )
        )
          return
        const probe = new Ledger(this.actors)
        const hostile =
          event.type === 'actionEffect'
            ? probe.hostile(event)
            : event.type === 'periodicTick' && probe.periodicHostile(event.data)
        if (!hostile) return
        encounter = this.create(at)
      }
    }
    let accepted = false,
      hostile = false
    if (event.type === 'periodicTick') {
      const key = tickKey(event.data)
      if (this.bindings.has(key)) return
      const target = event.data.target
      const before =
        event.data.isHeal && target !== null ? this.hpTracker.beforeTick(target, event.packet?.timestamp) : null
      accepted = encounter.ledger.periodic(event.data, false, event.packet?.timestamp, before)
      hostile = accepted && encounter.ledger.periodicHostile(event.data)
      if (accepted && event.data.statusId === 0 && event.data.phase !== 'post') this.bindings.set(key, encounter)
      if (accepted) {
        this.attributionTicks.set(key, encounter)
        if (this.attributionTicks.size > attributionTickLimit)
          this.attributionTicks.delete(this.attributionTicks.keys().next().value!)
      }
    } else if (event.type === 'actionEffect' || event.type === 'actorDied') {
      if (event.type === 'actorDied') encounter.outcome.death(this.actors.get(event.data.actorId ?? -1), at)
      else encounter.outcome.action(this.actors.get(event.data.sourceActorId ?? -1), at)
      ;({ accepted, hostile } = encounter.ledger.direct(event, at, (id) => this.hpTracker.current(id)))
      if (event.type === 'actionEffect') this.lastEffect = { seq: event.packet.seq, encounter }
    }
    if (accepted) {
      encounter.start = Math.min(encounter.start, at)
      encounter.end = Math.max(encounter.end, at)
      if (hostile) encounter.hostile = Math.max(encounter.hostile, at)
      this.notify(encounter, encounter.closedAt !== null)
    }
    this.trailing = true
    try {
      this.advance(now)
    } finally {
      this.trailing = false
    }
  }
}
