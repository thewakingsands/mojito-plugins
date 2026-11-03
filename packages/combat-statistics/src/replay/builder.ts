import type { GameEvent, Status } from '@ffcafe/mojito-plugin-sdk'
import { roleOf } from '../jobs.js'
import type { LedgerEntry } from '../ledger.js'
import type { ReplayObservers } from '../log/replay.js'
import type { LogRecord } from '../log/types.js'
import type { Actor } from '../model.js'
import {
  ENTRY_FIELDS,
  HIT_CRITICAL,
  HIT_DIRECT,
  HIT_DIRECT_HIT,
  type Hit,
  type ReplayActor,
  type ReplayData,
  type ReplayEvent,
  type StatusNote,
} from '../view-model.js'
import { bossEvents } from './bosses.js'
import { partyMitigations, penaltyStatuses, raidBuffs } from './catalog.js'
import { cutsceneEvents } from './cutscenes.js'

/** How far back the hits of a death go */
const RECENT_MS = 10_000
const RECENT_HITS = 10
/** A hit of at least this share of the maximum HP is a big hit, unless its target dies within CONFIRM_MS */
const BIG_HIT_SHARE = 0.5
const CONFIRM_MS = 1000
/** How long before a penalty the enemy effect that caused it may come */
const CAUSE_MS = 1000
const AUTO_ATTACKS = new Set([7, 8])

type ActorKey = string
interface Sample {
  t: number
  x: number
  z: number
  rotation: number
  hp: number
}
interface TakenHit {
  t: number
  source: ActorKey | null
  skill: string
  amount: number
}
interface OpenStatus {
  statusId: number
  source: ActorKey | null
  from: number
  stacks: number | null
}
interface Cause {
  t: number
  source: ActorKey | null
  actionId: number | null
}
type Pending =
  | { kind: 'death'; t: number; actor: ActorKey; recent: TakenHit[]; maxHp: number | null; statuses: StatusNote[] }
  | {
      kind: 'penalty'
      t: number
      actor: ActorKey
      statusId: number
      durationMs: number | null
      stacks: number | null
      cause: Cause
    }
  | { kind: 'bigHit'; t: number; actor: ActorKey; hit: TakenHit; maxHp: number; statuses: StatusNote[] }

/** What finish() gives: everything but the names and kinds of the game data, which the worker looks up */
export type PartialReplay = Omit<ReplayData, 'actions' | 'statusInfo'> & {
  /** Every Action the data refers to; ReplayData.actions follows this order */
  actionIds: number[]
  /** Every Status the data refers to */
  statusIds: number[]
}

/** The value of a key, added first when it is missing */
function ensure<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  let value = map.get(key)
  if (value === undefined) {
    value = create()
    map.set(key, value)
  }
  return value
}
const isMember = (actor: Actor | undefined) => actor?.kind === 'member'
const statusKey = (status: Status) => `${status.statusId}:${status.sourceActorId}`
const stacksOf = (status: Status) => (status.param > 1 ? status.param : null)

/**
 * Collects one fight while the visit is replayed, as the observers of replay(); finish() turns it into the review
 * data once the whole visit is done, when the rDPS splits that come after the fight have been booked too.
 */
export class ReplayBuilder implements Required<ReplayObservers> {
  private readonly durationMs: number
  /** The last identity of each actor seen in the fight */
  private readonly known = new Map<ActorKey, Actor>()
  private byId: ReadonlyMap<number, Actor> = new Map()
  private readonly members = new Set<ActorKey>()
  /** Enemies the members or their pets damaged */
  private readonly engaged = new Set<ActorKey>()
  private readonly tracks = new Map<ActorKey, Sample[]>()
  private readonly maxHp = new Map<ActorKey, number>()
  private readonly open = new Map<ActorKey, Map<string, OpenStatus>>()
  private readonly slots = new Map<ActorKey, Map<number, string>>()
  private readonly intervals: (OpenStatus & { actor: ActorKey; to: number })[] = []
  private readonly entries: {
    t: number
    actor: ActorKey
    other: ActorKey | null
    skill: string
    field: number
    hit: number
    amount: number
  }[] = []
  /** The damage each member took in the last RECENT_MS */
  private readonly taken = new Map<ActorKey, TakenHit[]>()
  /** The last enemy effect on each member */
  private readonly lastEnemyEffect = new Map<ActorKey, Cause>()
  private readonly pending: Pending[] = []
  /** The first actorDied of each enemy */
  private readonly enemyDeaths = new Map<ActorKey, number>()
  private readonly casts: {
    t: number
    actor: ActorKey
    durationMs: number
    actionId: number
    cancelledAt: number | null
  }[] = []
  private readonly uses: { t: number; actor: ActorKey; actionId: number }[] = []
  private readonly usesSeen = new Set<string>()
  /** The last change of each enemy before the fight; only the state it left counts */
  private readonly targetableBefore = new Map<ActorKey, boolean>()
  private readonly targetables: { t: number; actor: ActorKey; targetable: boolean }[] = []
  /** Whether a cutscene was playing before the fight, null when no change came */
  private cutsceneBefore: boolean | null = null
  private readonly cutscenes: { t: number; playing: boolean }[] = []
  private readonly potency: {
    t: number
    actor: ActorKey
    target: ActorKey | null
    actionId: number
    amount: number
    potency: number
    multiplier: number
    factors: { statusId: number; source: ActorKey | null; holder: 'caster' | 'target'; value: number }[]
  }[] = []

  /** @param fight Where the log puts the fight, by its fightStart and fightEnd */
  constructor(
    private readonly fightId: string,
    private readonly fight: { visitId: string; startAt: number; endAt: number },
  ) {
    this.durationMs = Math.max(0, Math.round(fight.endAt - fight.startAt))
  }

  /** Review time of a source time, within the fight */
  private time(at: number) {
    return Math.min(this.durationMs, Math.max(0, Math.round(at - this.fight.startAt)))
  }
  private actor(id: number | null): Actor | undefined {
    const actor = this.byId.get(id ?? -1)
    if (actor) this.known.set(actor.key, actor)
    return actor
  }

  /**
   * The host sends these only when they change, so the ones before the fight tell the state it starts in. They do not
   * make an enemy known: an enemy takes part in the review only when it is damaged.
   */
  private scene(sample: Extract<LogRecord, { kind: 'event' }>['sample'], actors: ReadonlyMap<number, Actor>) {
    const event = sample.value
    const at = sample.meta.observedAt
    if (at > this.fight.endAt) return
    const before = at < this.fight.startAt
    if (event.type === 'cutsceneChanged') {
      if (before) this.cutsceneBefore = event.data.playing
      else this.cutscenes.push({ t: this.time(at), playing: event.data.playing })
    } else if (event.type === 'targetableChanged') {
      const actor = actors.get(event.data.actorId)
      if (!actor) return
      if (before) this.targetableBefore.set(actor.key, event.data.targetable)
      else this.targetables.push({ t: this.time(at), actor: actor.key, targetable: event.data.targetable })
    }
  }

  record(record: LogRecord, state: { fightId: string | null; actors: ReadonlyMap<number, Actor> }) {
    if (record.kind === 'event') this.scene(record.sample, state.actors)
    if (state.fightId !== this.fightId) return
    const first = this.byId.size === 0
    this.byId = state.actors
    if (first || record.kind === 'identities')
      for (const actor of state.actors.values())
        if (isMember(actor)) {
          this.members.add(actor.key)
          this.known.set(actor.key, actor)
        }
    if (record.kind === 'positions') {
      const t = this.time(record.t)
      for (const position of record.actors) {
        const actor = this.actor(position.id)
        if (actor?.kind !== 'member' && actor?.kind !== 'enemy') continue
        const track = ensure(this.tracks, actor.key, () => [])
        const known = position.hpCur !== null && position.hpMax !== null && position.hpMax > 0
        track.push({
          t,
          x: position.x,
          z: position.z,
          rotation: position.rotation,
          hp: known ? position.hpCur! / position.hpMax! : Number.NaN,
        })
        if (known) this.maxHp.set(actor.key, position.hpMax!)
      }
    } else if (record.kind === 'event') {
      const at = record.sample.meta.observedAt
      if (record.sample.value.type === 'potencySample') this.sample(record.sample.value.data, at)
      else this.event(record.sample.value, this.time(at))
    }
  }

  private sample(data: GameEvent<'potencySample'>['data'], at: number) {
    if (at < this.fight.startAt || at > this.fight.endAt || !(data.potency > 0)) return
    const caster = this.actor(data.casterId)
    if (caster?.kind !== 'member') return
    this.potency.push({
      t: this.time(at),
      actor: caster.key,
      target: this.actor(data.targetId)?.key ?? null,
      actionId: data.actionId,
      amount: data.amount,
      potency: data.potency,
      multiplier: data.multiplier,
      factors: data.factors.map((factor) => ({
        statusId: factor.statusId,
        source: this.actor(factor.sourceId)?.key ?? null,
        holder: factor.holder,
        value: factor.value,
      })),
    })
  }

  private event(event: GameEvent, t: number) {
    switch (event.type) {
      case 'castStarted': {
        const caster = this.actor(event.data.casterId)
        if (caster?.kind === 'member' || caster?.kind === 'enemy')
          this.casts.push({
            t,
            actor: caster.key,
            durationMs: event.data.durationMs,
            actionId: event.data.actionId,
            cancelledAt: null,
          })
        break
      }
      case 'castCancelled': {
        const caster = this.actor(event.data.casterId)
        if (!caster) break
        const cast = this.casts.findLast((item) => item.actor === caster.key && item.actionId === event.data.actionId)
        if (cast && cast.cancelledAt === null && cast.t + cast.durationMs > t) cast.cancelledAt = t
        break
      }
      case 'statusChanged': {
        const actor = this.actor(event.data.actorId)
        if (actor?.kind !== 'member' && actor?.kind !== 'enemy') break
        const slots = this.slotsOf(actor.key)
        const before = slots.get(event.data.slot)
        const status = event.data.status
        const key = status && statusKey(status)
        if (key) slots.set(event.data.slot, key)
        else slots.delete(event.data.slot)
        if (before && before !== key && ![...slots.values()].includes(before)) this.close(actor.key, before, t)
        if (status) this.apply(actor, status, t)
        break
      }
      case 'statusesReplaced': {
        const actor = this.actor(event.data.actorId)
        if (actor?.kind !== 'member' && actor?.kind !== 'enemy') break
        const keys = event.data.statuses.map(statusKey)
        for (const key of [...this.statusesOf(actor.key).keys()]) if (!keys.includes(key)) this.close(actor.key, key, t)
        this.slots.set(actor.key, new Map(keys.map((key, slot) => [slot, key])))
        for (const status of event.data.statuses) this.apply(actor, status, t)
        break
      }
      case 'actorDied': {
        const actor = this.actor(event.data.actorId)
        if (actor?.kind === 'enemy') {
          if (!this.enemyDeaths.has(actor.key)) this.enemyDeaths.set(actor.key, t)
        } else if (actor?.kind === 'member') this.died(actor.key, t)
        break
      }
      case 'actionEffect': {
        const source = this.actor(event.data.sourceActorId)
        for (const target of event.data.targets) {
          const receiver = this.actor(target.targetId)
          if (source?.kind === 'enemy' && receiver?.kind === 'member')
            this.lastEnemyEffect.set(receiver.key, { t, source: source.key, actionId: event.data.actionId })
        }
        if (source?.kind !== 'member' && source?.kind !== 'pet') break
        if (event.data.actionType !== 1 || AUTO_ATTACKS.has(event.data.actionId)) break
        const seen = `${source.key}:${event.data.sequence}`
        if (this.usesSeen.has(seen)) break
        this.usesSeen.add(seen)
        const user = source.kind === 'pet' && source.ownerKey ? source.ownerKey : source.key
        this.uses.push({ t, actor: user, actionId: event.data.actionId })
        break
      }
    }
  }

  private statusesOf(actor: ActorKey) {
    return ensure(this.open, actor, () => new Map<string, OpenStatus>())
  }
  private slotsOf(actor: ActorKey) {
    return ensure(this.slots, actor, () => new Map<number, string>())
  }
  private sourceOf(status: Status) {
    return this.actor(status.sourceActorId)?.key ?? null
  }
  /** Opens a status that was not there, or takes the stacks of one that was */
  private apply(actor: Actor, status: Status, t: number) {
    const open = this.statusesOf(actor.key)
    const key = statusKey(status)
    const current = open.get(key)
    if (current) {
      current.stacks = stacksOf(status)
      return
    }
    const source = this.sourceOf(status)
    open.set(key, { statusId: status.statusId, source, from: t, stacks: stacksOf(status) })
    if (actor.kind !== 'member' || !penaltyStatuses.has(status.statusId)) return
    const effect = this.lastEnemyEffect.get(actor.key)
    this.pending.push({
      kind: 'penalty',
      t,
      actor: actor.key,
      statusId: status.statusId,
      durationMs: status.durationMs,
      stacks: stacksOf(status),
      cause: effect && t - effect.t <= CAUSE_MS ? effect : { t, source, actionId: null },
    })
  }
  private close(actor: ActorKey, key: string, t: number) {
    const open = this.statusesOf(actor)
    const status = open.get(key)
    if (!status) return
    open.delete(key)
    this.intervals.push({ ...status, actor, to: t })
  }
  private notes(actor: ActorKey): StatusNote[] {
    return [...this.statusesOf(actor).values()].map((status) => ({
      statusId: status.statusId,
      name: null,
      since: status.from,
    }))
  }
  private died(actor: ActorKey, t: number) {
    const recent = (this.taken.get(actor) ?? []).filter((hit) => hit.t >= t - RECENT_MS && hit.t <= t)
    this.pending.push({
      kind: 'death',
      t,
      actor,
      recent: recent.reverse().slice(0, RECENT_HITS),
      maxHp: this.maxHp.get(actor) ?? null,
      statuses: this.notes(actor),
    })
    // A hit the target died of is the killing blow, not a big hit
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const item = this.pending[i]
      if (item.kind === 'bigHit' && item.actor === actor && item.t >= t - CONFIRM_MS) this.pending.splice(i, 1)
    }
  }

  ledger(fightId: string, entry: LedgerEntry) {
    if (fightId !== this.fightId || (entry.actor.kind !== 'member' && entry.actor.kind !== 'pet')) return
    if (!this.known.has(entry.actor.key)) this.known.set(entry.actor.key, entry.actor)
    const t = this.time(entry.t)
    const hit = entry.hit
    this.entries.push({
      t,
      actor: entry.actor.key,
      other: entry.other,
      skill: entry.skill,
      field: ENTRY_FIELDS.indexOf(entry.field),
      hit: hit ? HIT_DIRECT | (hit.critical ? HIT_CRITICAL : 0) | (hit.direct ? HIT_DIRECT_HIT : 0) : 0,
      amount: entry.amount,
    })
    if (entry.field === 'damage' && entry.other !== null) this.engaged.add(entry.other)
    if (entry.field === 'taken' && entry.actor.kind === 'member') this.took(entry, t)
  }
  private took(entry: LedgerEntry, t: number) {
    const hits = ensure(this.taken, entry.actor.key, () => [])
    while (hits.length && hits[0].t < t - RECENT_MS) hits.shift()
    // A revised tick takes back what it booked before, at the same time
    if (entry.amount < 0) {
      const index = hits.findLastIndex(
        (hit) => hit.t === t && hit.skill === entry.skill && hit.amount === -entry.amount,
      )
      if (index >= 0) hits.splice(index, 1)
      return
    }
    // Ticks of damage over time come from no actor
    const source = entry.other !== null && this.known.has(entry.other) ? entry.other : null
    const taken = { t, source, skill: entry.skill, amount: entry.amount }
    hits.push(taken)
    const maxHp = this.maxHp.get(entry.actor.key)
    if (entry.skill.startsWith('action:') && maxHp !== undefined && entry.amount >= maxHp * BIG_HIT_SHARE)
      this.pending.push({
        kind: 'bigHit',
        t,
        actor: entry.actor.key,
        hit: taken,
        maxHp,
        statuses: this.notes(entry.actor.key),
      })
  }

  /** @param mainEnemyKey The main enemy of the fight's Summary */
  finish(mainEnemyKey: string | null): PartialReplay {
    for (const [actor, open] of this.open) for (const key of [...open.keys()]) this.close(actor, key, this.durationMs)

    const actors: ReplayActor[] = []
    const index = new Map<ActorKey, number>()
    const add = (key: ActorKey, kind: ReplayActor['kind']) => {
      if (index.has(key)) return
      const actor = this.known.get(key)
      const samples = kind === 'pet' ? [] : (this.tracks.get(key) ?? [])
      index.set(key, actors.length)
      actors.push({
        index: actors.length,
        key,
        name: actor?.name ?? null,
        kind,
        owner: null,
        main: key === mainEnemyKey,
        job: actor?.job ?? null,
        role: kind === 'member' ? roleOf(actor?.job ?? null) : null,
        track: {
          t: Uint32Array.from(samples, (sample) => sample.t),
          x: Float32Array.from(samples, (sample) => sample.x),
          z: Float32Array.from(samples, (sample) => sample.z),
          rotation: Float32Array.from(samples, (sample) => sample.rotation),
          hp: Float32Array.from(samples, (sample) => sample.hp),
        },
      })
    }
    for (const key of this.members) add(key, 'member')
    for (const entry of this.entries) {
      const actor = this.known.get(entry.actor)
      if (actor?.kind === 'member') add(entry.actor, 'member')
    }
    for (const entry of this.entries) {
      const actor = this.known.get(entry.actor)
      if (actor?.kind === 'pet' && actor.ownerKey && index.has(actor.ownerKey)) {
        add(entry.actor, 'pet')
        actors[index.get(entry.actor)!].owner = index.get(actor.ownerKey)!
      }
    }
    for (const key of this.engaged) if (this.known.get(key)?.kind === 'enemy') add(key, 'enemy')
    const at = (key: ActorKey | null) => (key === null ? null : (index.get(key) ?? null))
    const name = (key: ActorKey | null) => (key === null ? null : (this.known.get(key)?.name ?? null))

    const actionIds: number[] = []
    const actionIndex = new Map<number, number>()
    const action = (id: number) => {
      let found = actionIndex.get(id)
      if (found === undefined) {
        found = actionIds.length
        actionIndex.set(id, found)
        actionIds.push(id)
      }
      return found
    }
    const statusIds = new Set<number>()

    const uses = this.uses.filter((use) => index.has(use.actor))
    const entries = this.entries.filter((entry) => index.has(entry.actor))
    const skills: string[] = []
    const skillIndex = new Map<string, number>()
    const skill = (key: string) => {
      let found = skillIndex.get(key)
      if (found === undefined) {
        found = skills.length
        skillIndex.set(key, found)
        skills.push(key)
        // Auto-attacks and enemy Actions are never recorded as uses, so the tables would have no name for them
        const match = /^(action|status):(\d+)$/.exec(key)
        if (match?.[1] === 'action') action(Number(match[2]))
        else if (match) statusIds.add(Number(match[2]))
      }
      return found
    }

    const casts = this.casts
      .filter((cast) => {
        const actor = actors[index.get(cast.actor) ?? -1]
        return actor && (actor.kind === 'member' || actor.main)
      })
      .map((cast) => {
        action(cast.actionId)
        return {
          t: cast.t,
          actor: index.get(cast.actor)!,
          durationMs: Math.min(cast.durationMs, this.durationMs - cast.t),
          actionId: cast.actionId,
          name: null,
          cancelledAt: cast.cancelledAt,
        }
      })

    const statuses = this.intervals
      .filter((status) => index.has(status.actor) && status.to > status.from)
      .sort((a, b) => a.from - b.from)
      .map((status) => {
        statusIds.add(status.statusId)
        return {
          actor: index.get(status.actor)!,
          statusId: status.statusId,
          source: at(status.source),
          from: status.from,
          to: status.to,
          stacks: status.stacks,
        }
      })

    const hit = (taken: TakenHit): Hit => {
      const periodic = taken.skill.startsWith('status:')
      const id = Number(taken.skill.slice(taken.skill.indexOf(':') + 1))
      if (periodic) statusIds.add(id)
      else action(id)
      return {
        t: taken.t,
        source: at(taken.source),
        sourceName: name(taken.source),
        actionId: id,
        name: null,
        amount: taken.amount,
        periodic,
      }
    }
    const notes = (list: StatusNote[]) => {
      for (const note of list) statusIds.add(note.statusId)
      return list
    }
    const events: ReplayEvent[] = []
    for (const item of this.pending) {
      const actor = index.get(item.actor)
      if (actor === undefined) continue
      if (item.kind === 'death') {
        const recentHits = item.recent.map(hit)
        events.push({
          kind: 'death',
          t: item.t,
          actor,
          killingBlow: recentHits[0] ?? null,
          recentHits,
          maxHp: item.maxHp,
          statuses: notes(item.statuses),
        })
      } else if (item.kind === 'bigHit')
        events.push({
          kind: 'bigHit',
          t: item.t,
          actor,
          hit: hit(item.hit),
          maxHp: item.maxHp,
          statuses: notes(item.statuses),
        })
      else {
        statusIds.add(item.statusId)
        if (item.cause.actionId !== null) action(item.cause.actionId)
        events.push({
          kind: 'penalty',
          t: item.t,
          actor,
          statusId: item.statusId,
          name: null,
          durationMs: item.durationMs,
          stacks: item.stacks,
          cause: {
            source: at(item.cause.source),
            sourceName: name(item.cause.source),
            actionId: item.cause.actionId,
            name: null,
          },
        })
      }
    }
    const potency = this.potency
      .filter((sample) => index.has(sample.actor))
      .sort((a, b) => a.t - b.t)
      .map((sample) => ({
        t: sample.t,
        actor: index.get(sample.actor)!,
        target: at(sample.target) ?? -1,
        actionId: sample.actionId,
        amount: sample.amount,
        potency: sample.potency,
        multiplier: sample.multiplier,
        factors: sample.factors.map((factor) => {
          // 0 is a modifier of the gauge, which has no Status
          if (factor.statusId !== 0) statusIds.add(factor.statusId)
          return { statusId: factor.statusId, source: at(factor.source), holder: factor.holder, value: factor.value }
        }),
      }))
    const typedEntries = {
      t: Uint32Array.from(entries, (entry) => entry.t),
      actor: Uint16Array.from(entries, (entry) => index.get(entry.actor)!),
      other: Int32Array.from(entries, (entry) => at(entry.other) ?? -1),
      skill: Uint16Array.from(entries, (entry) => skill(entry.skill)),
      field: Uint8Array.from(entries, (entry) => entry.field),
      hit: Uint8Array.from(entries, (entry) => entry.hit),
      amount: Float64Array.from(entries, (entry) => entry.amount),
    }
    const deaths = new Map<number, number>()
    for (const [key, t] of this.enemyDeaths) if (index.has(key)) deaths.set(index.get(key)!, t)
    const targetables = [
      ...[...this.targetableBefore].map(([actor, targetable]) => ({ t: 0, actor, targetable })),
      ...this.targetables,
    ].flatMap(({ t, actor, targetable }) => (index.has(actor) ? [{ t, actor: index.get(actor)!, targetable }] : []))
    events.push(...bossEvents(actors, typedEntries, deaths, this.durationMs, targetables))
    const cutscenes =
      this.cutsceneBefore === null ? this.cutscenes : [{ t: 0, playing: this.cutsceneBefore }, ...this.cutscenes]
    events.push(...cutsceneEvents(cutscenes, this.durationMs))
    events.sort((a, b) => a.t - b.t)

    return {
      fight: { visitId: this.fight.visitId, fightId: this.fightId, durationMs: this.durationMs },
      actors,
      casts,
      uses: {
        t: Uint32Array.from(uses, (use) => use.t),
        actor: Uint16Array.from(uses, (use) => index.get(use.actor)!),
        action: Uint16Array.from(uses, (use) => action(use.actionId)),
      },
      entries: typedEntries,
      skills,
      statuses,
      events,
      potency,
      actionIds,
      statusIds: [...statusIds],
    }
  }
}

/** The game data finish() leaves out, as the worker reads it; null where it could not be read */
export interface GameData {
  action(id: number): string | null
  status(id: number): string | null
  /** Whether the Action is a weaponskill or spell on the global cooldown */
  gcd(id: number): boolean | null
  category(id: number): 'buff' | 'debuff' | null
}

/** Fills in the names and kinds of the game data */
export function complete(partial: PartialReplay, data: GameData): ReplayData {
  const { actionIds, statusIds, ...rest } = partial
  const hit = (value: Hit): Hit => ({
    ...value,
    name: value.actionId === null ? null : value.periodic ? data.status(value.actionId) : data.action(value.actionId),
  })
  const notes = (list: StatusNote[]) => list.map((note) => ({ ...note, name: data.status(note.statusId) }))
  return {
    ...rest,
    casts: rest.casts.map((cast) => ({ ...cast, name: data.action(cast.actionId) })),
    actions: actionIds.map((actionId) => {
      const buff = raidBuffs.get(actionId),
        mitigation = partyMitigations.get(actionId)
      return {
        actionId,
        name: data.action(actionId),
        gcd: data.gcd(actionId) ?? false,
        lane: buff !== undefined ? 'buff' : mitigation !== undefined ? 'mitigation' : null,
        durationMs: buff ?? mitigation ?? null,
      }
    }),
    statusInfo: statusIds.map((statusId) => ({
      statusId,
      name: data.status(statusId),
      category: data.category(statusId),
    })),
    events: rest.events.map((event) => {
      switch (event.kind) {
        case 'death':
          return {
            ...event,
            killingBlow: event.killingBlow && hit(event.killingBlow),
            recentHits: event.recentHits.map(hit),
            statuses: notes(event.statuses),
          }
        case 'bigHit':
          return { ...event, hit: hit(event.hit), statuses: notes(event.statuses) }
        case 'penalty':
          return {
            ...event,
            name: data.status(event.statusId),
            cause: {
              ...event.cause,
              name: event.cause.actionId === null ? null : data.action(event.cause.actionId),
            },
          }
        default:
          return event
      }
    }),
  }
}
