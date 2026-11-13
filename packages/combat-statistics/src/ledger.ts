import { periodicDefs } from '@ffcafe/mojito-combat-model/defs'
import type { AttributionPart, DamageAttribution, GameEvent, PeriodicTick } from './combat-events.js'
import type { Hp } from './hp-tracker.js'
import {
  type Actor,
  amounts,
  LIMIT_BREAK_ACTOR,
  limitBreakSkill,
  type Metric,
  metric,
  REFLECT_SKILL,
  type Row,
  type RowSummary,
  type Summary,
  skillAmounts,
} from './model.js'
import { mergeTime, SettlementTime, type TimeBounds } from './settlement-time.js'

type Contribution = {
  actor: Actor
  field: 'damage' | 'healing' | 'taken' | 'healingTaken'
  amount: number
  estimated: boolean
  target: string
  skill: string
  overhealed?: number
  unmeasured?: number
  /** Flags of a direct damage hit */
  hit?: { critical: boolean; direct: boolean }
}
/** One amount the ledger booked, as the fight review reads it back. */
export interface LedgerEntry {
  /** The at the ledger booked it with */
  t: number
  field: 'damage' | 'healing' | 'taken' | 'overheal' | 'given' | 'received'
  /** Whose row it is booked on */
  actor: Actor
  /** The key of the target of damage and healing, of the source of taken; null for the other fields */
  other: string | null
  /** The key of Row.skills */
  skill: string
  /** Below zero where a revision takes back what was booked before */
  amount: number
  /** Set on direct damage only */
  hit: { critical: boolean; direct: boolean } | null
}
type ActorSnapshot = ReadonlyMap<number, Actor>
type Pending = {
  actors: ActorSnapshot
  packetAt?: number
  tick: PeriodicTick
  contributions: Contribution[]
  unknown: number
  outside: number
  observed: number
  /** Overheal of the whole tick, worked out when it first arrives; null when the target HP was unknown */
  overhealed: number | null
}
/** hp is the target HP when the actionEffect arrived, for heals whose EffectResult never comes */
type PendingHeal = { at: number; hp: Hp | null; items: { actor: Actor; skill: string; amount: number }[] }
/** Heals whose EffectResult has not arrived by then use the target HP of their actionEffect instead. */
const healTimeoutMs = 5000
const inScope = (actor: Actor | undefined): actor is Actor & { kind: 'member' | 'pet' } =>
  actor?.kind === 'member' || actor?.kind === 'pet'
/** The rows that the summary and the settlement time count: those in scope and the limit break row */
const counted = (actor: Actor | undefined) => inScope(actor) || actor?.kind === 'limitBreak'
const damageTypes = new Set([3, 5, 6])
const attempts = new Set([1, 2, 3, 5, 6, 7])
const ignoredTypes = new Set([0, 8, 10, 11, 12, 13, 14, 15, 20, 24, 25, 27, 28, 31, 33, 40, 52, 59, 61, 62, 73])
/** The effect lands on the source of the action instead of its target */
const EFFECT_ON_SOURCE = 0x80
/** Damage the target of the action reflects onto its source */
const REFLECTED = 0xa0
/** Only widens rawValue, so it says nothing about who gives or takes the effect */
const EXTENDED_VALUE = 0x40
export const tickKey = (tick: Pick<PeriodicTick, 'estimatorGeneration' | 'tickId'>) =>
  `${tick.estimatorGeneration}:${tick.tickId}`
/** Adds the id to the ranges of its generation; false when they had it already */
export function remember(ranges: Map<number, [number, number][]>, generation: number, id: number): boolean {
  const current = ranges.get(generation) ?? []
  if (current.some(([from, to]) => id >= from && id <= to)) return false
  current.push([id, id])
  current.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const range of current) {
    const last = merged.at(-1)
    if (last && range[0] <= last[1] + 1) last[1] = Math.max(last[1], range[1])
    else merged.push(range)
  }
  ranges.set(generation, merged)
  return true
}
export const remembered = (ranges: Map<number, [number, number][]>, generation: number, id: number) =>
  ranges.get(generation)?.some(([from, to]) => id >= from && id <= to) ?? false
/** a + b, unknown when either is: rows and skills saved before rDPS have no contribution */
const plus = (a: number | undefined, b: number | undefined) => (a === undefined || b === undefined ? undefined : a + b)
export const NO_CONTRIBUTION = '这场战斗没有 rDPS 数据'
export function overhealMetrics(
  healing: number,
  overhealed: number,
  unmeasured: number,
  partial: boolean,
): { overheal: Metric; effectiveHealing: Metric } {
  if (healing === 0) return { overheal: metric(0), effectiveHealing: metric(0) }
  if (unmeasured >= healing) {
    const unavailable = metric(null, 'unavailable', '治疗生效时没有目标 HP')
    return { overheal: unavailable, effectiveHealing: { ...unavailable } }
  }
  const [quality, reason] =
    unmeasured > 0
      ? (['partial', '部分治疗缺少目标 HP，过量治疗只计算其余部分'] as const)
      : partial
        ? (['partial', undefined] as const)
        : (['estimated', '按治疗生效前收到的目标 HP 推算'] as const)
  return {
    overheal: metric(overhealed, quality, reason),
    effectiveHealing: metric(healing - overhealed, quality, reason),
  }
}
const actorFields = ['key', 'id', 'name', 'worldId', 'job', 'kind', 'ownerKey'] as const
function refreshSnapshot(snapshot: ActorSnapshot, actors: ActorSnapshot, keepLifetimes: boolean): ActorSnapshot {
  let next: Map<number, Actor> | undefined
  for (const [id, current] of actors) {
    const original = snapshot.get(id)
    if (keepLifetimes && original?.key !== current.key) continue
    if (original && actorFields.every((field) => original[field] === current[field])) continue
    next ??= new Map(snapshot)
    next.set(id, { ...current })
  }
  return next ?? snapshot
}
export class Ledger {
  readonly rows = new Map<string, Row>()
  readonly pending = new Map<string, Pending>()
  /** Direct heals waiting for the HP of their EffectResult, by `${sequence}:${targetId}` */
  private readonly heals = new Map<string, PendingHeal>()
  private readonly time = new SettlementTime()
  private actorSnapshot: ActorSnapshot
  readonly diagnostics: Summary['diagnostics'] = {
    unassignedObservedDamage: 0,
    outOfScopeDamage: 0,
    observedTargetDamage: 0,
    unknownEffects: 0,
    invalidRevisions: 0,
    unknownActors: 0,
    unmatchedAttributions: 0,
    outOfScopeContribution: 0,
  }
  /** Why contributionDps is unavailable; null when the host splits the damage */
  contributionUnavailable: string | null = null
  /** Sees every amount booked, the review's way to rebuild the totals over any span of time */
  observer: ((entry: LedgerEntry) => void) | null = null
  /** The outgoing hits of the last actionEffect, which its damageAttributed events split */
  private lastHits: { seq: number; hits: { actorId: number; targetId: number; actionId: number; amount: number }[] } = {
    seq: -1,
    hits: [],
  }
  readonly quality = new Set<string>(['仅统计插件启动后收到的事实'])
  private buckets = new Map<number, Map<string, { separate: number; merged: number }>>()
  private lastSecond = -Infinity
  private seen = new Map<string, number>()
  private processed = new Map<number, [number, number][]>()
  constructor(readonly actors: Map<number, Actor>) {
    this.actorSnapshot = new Map([...actors].map(([id, actor]) => [id, { ...actor }]))
  }
  refresh(actors: Map<number, Actor>) {
    for (const [id, actor] of actors) {
      this.actors.set(id, actor)
      const row = this.rows.get(actor.key)
      if (row) {
        const wasInScope = inScope(row.actor),
          nowInScope = inScope(actor)
        if (wasInScope !== nowInScope) this.diagnostics.outOfScopeDamage += row.totals.damage * (nowInScope ? -1 : 1)
        row.actor = { ...actor }
      }
    }
    const previous = this.actorSnapshot
    this.actorSnapshot = refreshSnapshot(previous, this.actors, false)
    const snapshots = new Map<ActorSnapshot, ActorSnapshot>()
    if (
      previous.size === this.actorSnapshot.size &&
      [...previous].every(([id, actor]) => this.actorSnapshot.get(id)?.key === actor.key)
    )
      snapshots.set(previous, this.actorSnapshot)
    for (const entry of this.pending.values()) {
      let refreshed = snapshots.get(entry.actors)
      if (!refreshed) {
        refreshed = refreshSnapshot(entry.actors, this.actors, true)
        snapshots.set(entry.actors, refreshed)
      }
      entry.actors = refreshed
      entry.outside = entry.tick.isHeal
        ? 0
        : entry.tick.shares
            .filter((share) => !inScope(entry.actors.get(share.sourceId ?? -1)))
            .reduce((sum, share) => sum + share.amount, 0)
      for (const contribution of entry.contributions) {
        const current = this.actors.get(contribution.actor.id)
        if (current?.key === contribution.actor.key) contribution.actor = current
      }
    }
  }
  private row(actor: Actor, at: number): Row {
    let row = this.rows.get(actor.key)
    if (!row) {
      row = {
        actor: { ...actor },
        firstAt: at,
        lastAt: at,
        totals: amounts(),
        estimatedDamage: 0,
        estimatedHealing: 0,
        maxHit: null,
        maxHeal: null,
        skills: {},
        targets: {},
        contribution: 0,
      }
      this.rows.set(actor.key, row)
    }
    return row
  }
  private recent(actor: Actor, value: number, at: number) {
    const second = Math.floor(at / 1000)
    this.lastSecond = Math.max(this.lastSecond, second)
    for (const key of this.buckets.keys()) if (key <= this.lastSecond - 60) this.buckets.delete(key)
    if (second <= this.lastSecond - 60) return
    let bucket = this.buckets.get(second)
    if (!bucket) {
      bucket = new Map()
      this.buckets.set(second, bucket)
    }
    const own = bucket.get(actor.key) ?? { separate: 0, merged: 0 }
    own.separate += value
    bucket.set(actor.key, own)
    const owner = actor.ownerKey ?? actor.key
    const merged = bucket.get(owner) ?? { separate: 0, merged: 0 }
    merged.merged += value
    bucket.set(owner, merged)
  }
  private add(c: Contribution, at: number, sign = 1, recent = false) {
    const row = this.row(c.actor, at),
      value = c.amount * sign
    row.totals[c.field] += value
    if (c.estimated && c.field === 'damage') row.estimatedDamage += value
    if (c.estimated && c.field === 'healing') row.estimatedHealing += value
    if (c.field === 'damage' || c.field === 'healing') {
      row.skills[c.skill] ??= skillAmounts()
      const skill = row.skills[c.skill]
      row.targets[c.target] ??= { damage: 0, healing: 0 }
      const target = row.targets[c.target]
      skill[c.field] += value
      target[c.field] += value
      if (c.field === 'damage') {
        // The damage stays with the actor until a split gives part of it to others
        skill.contribution = plus(skill.contribution, value)
        row.contribution = plus(row.contribution, value)
        if (recent) this.recent(c.actor, value, at)
      }
    }
    if (c.field !== 'healingTaken')
      this.observer?.({
        t: at,
        field: c.field,
        actor: c.actor,
        other: c.target,
        skill: c.skill,
        amount: value,
        hit: c.hit ?? null,
      })
  }
  /**
   * Takes the split of a hit of the last actionEffect: the hit of the same actor, target, action and amount, each
   * hit once. Returns whether a hit matched.
   */
  attributeHit(seq: number, data: DamageAttribution, at: number): boolean {
    const { origin } = data
    const index =
      origin.type === 'action' && this.lastHits.seq === seq
        ? this.lastHits.hits.findIndex(
            (hit) =>
              hit.actorId === data.actorId &&
              hit.targetId === data.targetId &&
              hit.actionId === origin.actionId &&
              hit.amount === data.amount,
          )
        : -1
    if (index < 0) {
      this.diagnostics.unmatchedAttributions++
      return false
    }
    const [hit] = this.lastHits.hits.splice(index, 1)
    return this.attribute(hit.actorId, `action:${hit.actionId}`, data.contributions, at)
  }
  /**
   * Gives the parts of the damage of the actor's skill to the statuses of the players who gave them, and takes them
   * from the skill. A delta of a closed window comes the same way, with parts below zero.
   */
  attribute(actorId: number | null, skillKey: string, contributions: readonly AttributionPart[], at: number): boolean {
    const actor = this.actors.get(actorId ?? -1)
    const row = inScope(actor) ? this.rows.get(actor.key) : undefined
    const skill = row?.skills[skillKey]
    if (!row || !skill) {
      this.diagnostics.unmatchedAttributions++
      return false
    }
    const given = contributions.reduce((sum, part) => sum + part.amount, 0)
    skill.contribution = plus(skill.contribution, -given)
    row.contribution = plus(row.contribution, -given)
    this.observer?.({
      t: at,
      field: 'given',
      actor: row.actor,
      other: null,
      skill: skillKey,
      amount: -given,
      hit: null,
    })
    for (const part of contributions) {
      const source = this.actors.get(part.sourceId ?? -1)
      if (!inScope(source)) {
        this.diagnostics.outOfScopeContribution += part.amount
        continue
      }
      // A provider who has not acted yet gets a row, but no settlement time
      const provider = this.row(source, at)
      const key = `status:${part.statusId}`
      provider.skills[key] ??= skillAmounts()
      const status = provider.skills[key]
      status.contribution = plus(status.contribution, part.amount)
      provider.contribution = plus(provider.contribution, part.amount)
      this.observer?.({
        t: at,
        field: 'received',
        actor: source,
        other: null,
        skill: key,
        amount: part.amount,
        hit: null,
      })
    }
    return true
  }
  private heal(actor: Actor, skill: string, overhealed: number, unmeasured: number, at: number, sign = 1) {
    const row = this.row(actor, at)
    row.skills[skill] ??= skillAmounts()
    for (const amounts of [row.totals, row.skills[skill]]) {
      amounts.overhealed += overhealed * sign
      amounts.unmeasuredHealing += unmeasured * sign
    }
    if (overhealed * sign !== 0)
      this.observer?.({ t: at, field: 'overheal', actor, other: null, skill, amount: overhealed * sign, hit: null })
  }
  /** before is the target HP the heals landed on, its hpMax filled in; null leaves them unmeasured */
  private settle(entry: PendingHeal, before: { hpCur: number; hpMax: number } | null, full: boolean, at: number) {
    if (!before) {
      for (const item of entry.items) this.heal(item.actor, item.skill, 0, item.amount, at)
      return
    }
    const total = entry.items.reduce((sum, item) => sum + item.amount, 0)
    const overhealed = full ? Math.max(0, total - Math.max(0, before.hpMax - before.hpCur)) : 0
    for (const item of entry.items)
      this.heal(item.actor, item.skill, total > 0 ? (overhealed * item.amount) / total : 0, 0, at)
  }
  /** The game often sends no EffectResult when the target is at full HP. */
  private settleWithoutResult(entry: PendingHeal, at: number) {
    const hp = entry.hp
    this.settle(entry, hp?.hpMax == null ? null : { hpCur: hp.hpCur, hpMax: hp.hpMax }, true, at)
  }
  private expireHeals(at: number) {
    for (const [key, entry] of this.heals)
      if (at - entry.at > healTimeoutMs) {
        this.settleWithoutResult(entry, at)
        this.heals.delete(key)
      }
  }
  /**
   * Settles the heals on the target of an EffectResult entry, before being the target HP before the entry. Returns
   * whether this ledger held such heals.
   */
  settleHeal(
    sequence: number,
    actorId: number,
    before: Hp | null,
    hpCur: number,
    hpMax: number | null,
    at: number,
  ): boolean {
    this.expireHeals(at)
    const key = `${sequence}:${actorId}`,
      entry = this.heals.get(key)
    if (!entry) return false
    this.heals.delete(key)
    const max = hpMax ?? before?.hpMax ?? null
    // A target left below its maximum HP took all of the healing.
    this.settle(entry, before && max !== null ? { hpCur: before.hpCur, hpMax: max } : null, hpCur >= (max ?? 0), at)
    return true
  }
  /** receiverId is the entity of the receiver and keys its pending heal; null books the heal as unmeasured */
  private bookHeal(
    source: Actor | undefined,
    receiver: Actor | undefined,
    receiverId: number | null,
    event: GameEvent<'actionEffect'>,
    amount: number,
    at: number,
    limitBreak: boolean,
    hpOf?: (actorId: number) => Hp | null,
  ) {
    const actionSkill = `action:${event.data.actionId}`
    if (inScope(source)) {
      const healer = limitBreak ? LIMIT_BREAK_ACTOR : source
      const skill = limitBreak ? limitBreakSkill(event.data.actionId, source.key) : actionSkill
      this.time.add(healer.key, at, event.packet.timestamp)
      this.add(
        { actor: healer, field: 'healing', amount, estimated: false, target: receiver?.key ?? 'unknown', skill },
        at,
      )
      if (receiverId === null) this.heal(healer, skill, 0, amount, at)
      else {
        const key = `${event.data.sequence}:${receiverId}`
        const entry = this.heals.get(key) ?? { at, hp: hpOf?.(receiverId) ?? null, items: [] }
        entry.items.push({ actor: healer, skill, amount })
        this.heals.set(key, entry)
      }
      const row = this.row(healer, at)
      if (!row.maxHeal || row.maxHeal.amount < amount)
        row.maxHeal = { actionId: event.data.actionId, actorKey: source.key, amount }
      if (limitBreak) this.caster(source, at)
    }
    if (inScope(receiver)) {
      this.time.add(receiver.key, at, event.packet.timestamp)
      this.add(
        {
          actor: receiver,
          field: 'healingTaken',
          amount,
          estimated: false,
          target: source?.key ?? 'unknown',
          skill: actionSkill,
        },
        at,
      )
    }
  }
  /** Keeps the name and job of who used a limit break on the limit break row, the latest ones */
  private caster(source: Actor, at: number) {
    const row = this.row(LIMIT_BREAK_ACTOR, at)
    row.casters ??= {}
    row.casters[source.key] = { name: source.name, job: source.job }
  }
  /**
   * Reflected damage has no swing and no critical or direct-hit flags, so it stays out of the hit counts and maxHit.
   * The host splits no buffs from damage on the source of an action, so it stays out of lastHits as well.
   */
  private bookReflect(dealer: Actor, enemy: Actor, amount: number, at: number, packetTimestamp: number) {
    this.time.add(dealer.key, at, packetTimestamp)
    this.add(
      { actor: dealer, field: 'damage', amount, estimated: false, target: enemy.key, skill: REFLECT_SKILL },
      at,
      1,
      true,
    )
    this.diagnostics.observedTargetDamage += amount
  }
  /**
   * One public packet identity can contain many targets/effects; deduplicate the event, never action sequence. hpOf
   * gives the current HP of a heal target.
   */
  direct(
    event: GameEvent<'actionEffect' | 'actorDied'>,
    at: number,
    hpOf?: (actorId: number) => Hp | null,
  ): { hostile: boolean; accepted: boolean } {
    if (event.packet.seq <= (this.seen.get(event.type) ?? -1)) return { hostile: false, accepted: false }
    this.seen.set(event.type, event.packet.seq)
    this.expireHeals(at)
    if (event.type === 'actorDied') {
      const actor = this.actors.get(event.data.actorId ?? -1)
      if (!inScope(actor)) return { hostile: false, accepted: false }
      const row = this.row(actor, at)
      row.totals[actor.kind === 'pet' ? 'petDeaths' : 'deaths']++
      this.time.add(actor.key, at, event.packet.timestamp)
      return { hostile: false, accepted: true }
    }
    const source = this.actors.get(event.data.sourceActorId ?? -1)
    this.lastHits = { seq: event.packet.seq, hits: [] }
    // A limit break of a member or pet goes to the limit break row, with who used it in the skill key
    const limitBreak = inScope(source) && periodicDefs.limitBreaks.has(event.data.actionId)
    const booked = limitBreak ? LIMIT_BREAK_ACTOR : source
    const skillKey = limitBreak ? limitBreakSkill(event.data.actionId, source.key) : `action:${event.data.actionId}`
    let hostile = false,
      accepted = false
    for (const target of event.data.targets) {
      const receiver = this.actors.get(target.targetId ?? -1)
      const outgoing = inScope(source) && receiver?.kind === 'enemy'
      const trackedOutgoing = (inScope(source) || source?.kind === 'unknown') && receiver?.kind === 'enemy'
      const incoming = source?.kind === 'enemy' && inScope(receiver)
      for (const effect of target.effects) {
        const flags = effect.rawFlags & ~EXTENDED_VALUE
        if (flags === EFFECT_ON_SOURCE && ignoredTypes.has(effect.typeCode)) continue
        const selfHeal = flags === EFFECT_ON_SOURCE && effect.typeCode === 4,
          reflected = flags === REFLECTED && effect.typeCode === 3
        if ((flags !== 0 && !selfHeal && !reflected) || !Number.isSafeInteger(effect.rawValue) || effect.rawValue < 0) {
          this.diagnostics.unknownEffects++
          continue
        }
        if (selfHeal) {
          if (inScope(source)) {
            accepted = true
            this.bookHeal(source, source, source.id, event, effect.rawValue, at, limitBreak, hpOf)
          }
          continue
        }
        if (reflected) {
          if (inScope(receiver) && source?.kind === 'enemy') {
            accepted = true
            this.bookReflect(receiver, source, effect.rawValue, at, event.packet.timestamp)
          }
          continue
        }
        if (attempts.has(effect.typeCode) && (trackedOutgoing || incoming)) {
          hostile ||= outgoing || incoming
          accepted ||= outgoing || incoming
          if (trackedOutgoing) {
            const row = this.row(booked!, at)
            this.time.add(booked!.key, at, event.packet.timestamp)
            if (limitBreak) this.caster(source, at)
            row.totals.swings++
            if (effect.typeCode === 1) row.totals.misses++
            else if (effect.typeCode === 2 || effect.typeCode === 7) row.totals.immune++
            else {
              row.totals.hits++
              row.totals.crit += Number(effect.critical)
              row.totals.direct += Number(effect.direct)
              row.totals.critDirect += Number(effect.critical && effect.direct)
              this.add(
                {
                  actor: booked!,
                  field: 'damage',
                  amount: effect.rawValue,
                  estimated: false,
                  target: receiver!.key,
                  skill: skillKey,
                  hit: { critical: effect.critical, direct: effect.direct },
                },
                at,
                1,
                true,
              )
              const skill = row.skills[skillKey]
              skill.hits++
              skill.directHits++
              skill.crit += Number(effect.critical)
              skill.direct += Number(effect.direct)
              skill.critDirect += Number(effect.critical && effect.direct)
              // The host splits no limit break, see DamageAttributor
              if (outgoing && !limitBreak)
                this.lastHits.hits.push({
                  actorId: source!.id,
                  targetId: receiver!.id,
                  actionId: event.data.actionId,
                  amount: effect.rawValue,
                })
              if (!row.maxHit || row.maxHit.amount < effect.rawValue)
                row.maxHit = { actionId: event.data.actionId, actorKey: source!.key, amount: effect.rawValue }
              this.diagnostics.observedTargetDamage += effect.rawValue
              if (!outgoing) this.diagnostics.outOfScopeDamage += effect.rawValue
            }
          } else if (damageTypes.has(effect.typeCode))
            this.add(
              {
                actor: receiver!,
                field: 'taken',
                amount: effect.rawValue,
                estimated: false,
                target: source!.key,
                skill: `action:${event.data.actionId}`,
              },
              at,
            )
        } else if (effect.typeCode === 4 && (inScope(source) || inScope(receiver))) {
          accepted = true
          this.bookHeal(source, receiver, target.targetId, event, effect.rawValue, at, limitBreak, hpOf)
          if (!receiver || !source) this.diagnostics.unknownActors++
        } else if (!ignoredTypes.has(effect.typeCode)) {
          if (!source || !receiver) this.diagnostics.unknownActors++
          else this.diagnostics.unknownEffects++
        }
      }
    }
    return { hostile, accepted }
  }
  /** Whether a row dealt damage to the actor of this key */
  damaged(key: string): boolean {
    for (const row of this.rows.values()) if ((row.targets[key]?.damage ?? 0) > 0) return true
    return false
  }
  hostile(event: GameEvent<'actionEffect'>): boolean {
    const source = this.actors.get(event.data.sourceActorId ?? -1)
    return event.data.targets.some((target) => {
      const receiver = this.actors.get(target.targetId ?? -1)
      return (
        ((inScope(source) && receiver?.kind === 'enemy') || (source?.kind === 'enemy' && inScope(receiver))) &&
        target.effects.some((effect) => attempts.has(effect.typeCode) && !(effect.rawFlags & ~0x40))
      )
    })
  }
  private allocation(tick: PeriodicTick, overhealed: number | null, identities = this.actorSnapshot): Pending | null {
    if (
      ![tick.total, tick.unknown, ...tick.shares.map((s) => s.amount)].every(
        (n) => Number.isSafeInteger(n) && n >= 0,
      ) ||
      tick.unknown + tick.shares.reduce((sum, s) => sum + s.amount, 0) !== tick.total
    )
      return null
    const receiver = identities.get(tick.target ?? -1),
      contributions: Contribution[] = []
    let outside = 0
    for (const share of tick.shares) {
      const source = identities.get(share.sourceId ?? -1)
      if (source && (inScope(source) || source.kind === 'unknown') && (tick.isHeal || receiver?.kind === 'enemy'))
        contributions.push({
          actor: source,
          field: tick.isHeal ? 'healing' : 'damage',
          amount: share.amount,
          estimated: share.basis === 'estimated' || share.basis === 'unconfirmed',
          target: receiver?.key ?? 'unknown',
          skill: `status:${share.statusId}`,
          ...(tick.isHeal &&
            (overhealed === null
              ? { overhealed: 0, unmeasured: share.amount }
              : { overhealed: tick.total > 0 ? (overhealed * share.amount) / tick.total : 0, unmeasured: 0 })),
        })
      if (!tick.isHeal && !inScope(source)) outside += share.amount
    }
    // Summed ticks that enemies or the environment put on a member have no shares and no known source,
    // so damage taken goes by the receiver alone.
    if (inScope(receiver))
      contributions.push({
        actor: receiver,
        field: tick.isHeal ? 'healingTaken' : 'taken',
        amount: tick.total,
        estimated: false,
        target: 'periodic',
        skill: `status:${tick.statusId}`,
      })
    return {
      actors: identities,
      tick: structuredClone(tick),
      contributions,
      unknown: !tick.isHeal && receiver?.kind === 'enemy' ? tick.unknown : 0,
      outside,
      observed: !tick.isHeal && receiver?.kind === 'enemy' ? tick.total : 0,
      overhealed,
    }
  }
  periodicHostile(tick: PeriodicTick): boolean {
    if (tick.isHeal) return false
    const receiver = this.actors.get(tick.target ?? -1)
    return tick.shares.some((s) => {
      const actor = this.actors.get(s.sourceId ?? -1)
      return (receiver?.kind === 'enemy' && inScope(actor)) || (inScope(receiver) && actor?.kind === 'enemy')
    })
  }
  /** before is the target HP before a first healing tick; revisions keep the overheal worked out then. */
  periodic(tick: PeriodicTick, revision = false, packetAt?: number, before?: Hp | null): boolean {
    const key = tickKey(tick),
      old = this.pending.get(key)
    if ((!revision && old) || (revision && !old)) return false
    let overhealed: number | null = 0
    if (old) overhealed = old.overhealed
    else if (tick.isHeal)
      overhealed = before?.hpMax == null ? null : Math.max(0, tick.total - Math.max(0, before.hpMax - before.hpCur))
    const next = this.allocation(tick, overhealed, old?.actors)
    if (
      !next ||
      (old &&
        (old.tick.total !== tick.total ||
          old.tick.occurredAt !== tick.occurredAt ||
          old.tick.target !== tick.target ||
          old.tick.isHeal !== tick.isHeal))
    ) {
      this.diagnostics.invalidRevisions++
      return false
    }
    if (!revision && !remember(this.processed, tick.estimatorGeneration, tick.tickId)) return false
    next.packetAt = old ? old.packetAt : packetAt
    for (const [entry, sign] of [
      [old, -1],
      [next, 1],
    ] as const) {
      if (!entry) continue
      for (const contribution of entry.contributions) {
        this.add(contribution, tick.occurredAt, sign, !revision)
        if (contribution.field === 'healing')
          this.heal(
            contribution.actor,
            contribution.skill,
            contribution.overhealed ?? 0,
            contribution.unmeasured ?? 0,
            tick.occurredAt,
            sign,
          )
        if (contribution.field === 'damage' && contribution.amount > 0) {
          const row = this.row(contribution.actor, tick.occurredAt)
          row.totals.swings += sign
          row.totals.hits += sign
          row.skills[contribution.skill].hits += sign
        }
      }
      this.diagnostics.unassignedObservedDamage += entry.unknown * sign
      this.diagnostics.outOfScopeDamage += entry.outside * sign
      this.diagnostics.observedTargetDamage += entry.observed * sign
    }
    this.time.replace(
      key,
      next.contributions.filter((c) => c.field !== 'taken').map((c) => c.actor.key),
      tick.occurredAt,
      next.packetAt,
    )
    if (tick.phase === 'post' || tick.statusId !== 0) {
      this.time.finish(key)
      this.pending.delete(key)
    } else this.pending.set(key, next)
    return true
  }
  seal() {
    for (const entry of this.heals.values()) this.settleWithoutResult(entry, entry.at)
    this.heals.clear()
    this.time.seal()
    this.pending.clear()
    this.processed.clear()
  }
  restore(row: RowSummary) {
    this.rows.set(row.actor.key, structuredClone(row))
    if (row.hasSettlementTime !== false) {
      this.time.add(row.actor.key, row.firstAt)
      this.time.add(row.actor.key, row.lastAt)
    }
  }
  settlement(): TimeBounds | null {
    let result: TimeBounds | null = null
    const times = this.time.snapshot()
    for (const row of this.rows.values())
      if (counted(row.actor)) result = mergeTime(result, times.get(row.actor.key) ?? null)
    return result
  }
  summary(start: number, end: number, mergePets: boolean, durationMs = end - start): RowSummary[] {
    const groups = new Map<string, Row>()
    const times = this.time.snapshot()
    const groupTimes = new Map<string, TimeBounds | null>()
    for (const row of this.rows.values()) {
      if (!counted(row.actor)) continue
      const key = mergePets && row.actor.ownerKey ? row.actor.ownerKey : row.actor.key
      let output = groups.get(key)
      if (!output) {
        const owner = this.rows.get(key)?.actor ?? [...this.actors.values()].find((actor) => actor.key === key)
        output = {
          ...structuredClone(row),
          actor: structuredClone(owner ?? row.actor),
          totals: amounts(),
          skills: {},
          targets: {},
          maxHit: null,
          maxHeal: null,
          estimatedDamage: 0,
          estimatedHealing: 0,
          contribution: 0,
        }
        groups.set(key, output)
      }
      output.contribution = plus(output.contribution, row.contribution)
      groupTimes.set(key, mergeTime(groupTimes.get(key) ?? null, times.get(row.actor.key) ?? null))
      for (const field of Object.keys(output.totals) as (keyof typeof output.totals)[])
        output.totals[field] += row.totals[field]
      output.estimatedDamage += row.estimatedDamage
      output.estimatedHealing += row.estimatedHealing
      for (const field of ['maxHit', 'maxHeal'] as const)
        if (row[field] && (!output[field] || row[field].amount > output[field].amount)) output[field] = row[field]
      for (const [id, amount] of Object.entries(row.skills)) {
        output.skills[id] ??= skillAmounts()
        const skill = output.skills[id]
        skill.damage += amount.damage
        skill.healing += amount.healing
        skill.hits += amount.hits
        skill.directHits += amount.directHits
        skill.crit += amount.crit
        skill.direct += amount.direct
        skill.critDirect += amount.critDirect
        skill.overhealed += amount.overhealed
        skill.unmeasuredHealing += amount.unmeasuredHealing
        skill.contribution = plus(skill.contribution, amount.contribution)
      }
      for (const [id, amount] of Object.entries(row.targets)) {
        output.targets[id] ??= { damage: 0, healing: 0 }
        const target = output.targets[id]
        target.damage += amount.damage
        target.healing += amount.healing
      }
    }
    const damage = [...groups.values()].reduce((sum, row) => sum + row.totals.damage, 0),
      healing = [...groups.values()].reduce((sum, row) => sum + row.totals.healing, 0)
    const duration = durationMs / 1000
    const partial =
      this.quality.size > 1 ||
      this.diagnostics.unknownEffects > 0 ||
      this.diagnostics.unknownActors > 0 ||
      this.diagnostics.unassignedObservedDamage > 0
    const rate = (value: number, denominator: number) => (denominator > 0 ? value / denominator : null)
    // Over the duration of encDps, so the two compare
    const contributionDps = (contribution: number | undefined) =>
      this.contributionUnavailable !== null
        ? metric(null, 'unavailable', this.contributionUnavailable)
        : contribution === undefined
          ? metric(null, 'unavailable', NO_CONTRIBUTION)
          : duration > 0
            ? metric(contribution / duration, partial ? 'partial' : 'estimated', '按团辅效果估算拆分')
            : metric(null)
    return [...groups.entries()].map(([key, row]) => {
      const time = groupTimes.get(key)
      row.hasSettlementTime = !!time
      const packet = time?.packetComplete && time.packetFirst !== null && time.packetLast !== null
      row.firstAt = packet ? time.packetFirst! : (time?.first ?? start)
      row.lastAt = packet ? time.packetLast! : (time?.last ?? start)
      const actorDuration = (row.lastAt - row.firstAt) / 1000
      const damageQuality = partial ? 'partial' : row.estimatedDamage > 0 ? 'estimated' : 'observed'
      const healingQuality = partial ? 'partial' : row.estimatedHealing > 0 ? 'estimated' : 'observed'
      const metrics: RowSummary['metrics'] = Object.fromEntries(
        Object.entries(row.totals).map(([key, value]) => [key, metric(value, partial ? 'partial' : 'observed')]),
      )
      Object.assign(metrics, {
        damage: metric(row.totals.damage, damageQuality),
        reportedHealing: metric(row.totals.healing, healingQuality),
        damageTaken: metric(row.totals.taken),
        encDps: metric(rate(row.totals.damage, duration), damageQuality),
        encHps: metric(rate(row.totals.healing, duration), healingQuality),
        dps: metric(rate(row.totals.damage, actorDuration), damageQuality),
        hps: metric(rate(row.totals.healing, actorDuration), healingQuality),
        critPct: metric(rate(row.totals.crit * 100, row.totals.hits)),
        directPct: metric(rate(row.totals.direct * 100, row.totals.hits)),
        critDirectPct: metric(rate(row.totals.critDirect * 100, row.totals.hits)),
        damagePct: metric(rate(row.totals.damage * 100, damage)),
        healingPct: metric(rate(row.totals.healing * 100, healing)),
      })
      for (const size of [10, 30, 60]) {
        let total = 0
        const second = Math.floor(end / 1000)
        for (const [key, bucket] of this.buckets)
          if (key > second - size && key <= second)
            total += bucket.get(row.actor.key)?.[mergePets ? 'merged' : 'separate'] ?? 0
        metrics[`last${size}Dps`] = metric(
          rate(total, Math.min(size, duration)),
          'estimated',
          '来源秒桶近似；不回写战后修订与旧宠物归属',
        )
        let ownerTotal = 0
        for (const [key, bucket] of this.buckets)
          if (key > second - size && key <= second)
            ownerTotal += bucket.get(row.actor.ownerKey ?? row.actor.key)?.merged ?? 0
        metrics[`last${size}OwnerDps`] = metric(
          rate(ownerTotal, Math.min(size, duration)),
          'estimated',
          '以原秒桶的宠物归属计算',
        )
      }
      Object.assign(
        metrics,
        overhealMetrics(row.totals.healing, row.totals.overhealed, row.totals.unmeasuredHealing, partial),
      )
      metrics.shield = metric(null, 'unavailable', '没有可靠输入')
      metrics.contributionDps = contributionDps(row.contribution)
      const skills = Object.fromEntries(
        Object.entries(row.skills).map(([id, skill]) => [
          id,
          {
            ...skill,
            overheal: overhealMetrics(skill.healing, skill.overhealed, skill.unmeasuredHealing, partial).overheal,
            contributionDps: contributionDps(skill.contribution),
          },
        ]),
      )
      return { ...row, skills, metrics }
    })
  }
}
