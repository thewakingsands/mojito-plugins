/** Drives a PeriodicEstimator with inputs, for the tests */
import { invalidTarget } from '../constants.js'
import type { PeriodicRevisionEvent, PeriodicTickEvent } from '../events.js'
import type { CombatInput, EffectTarget, HitResult } from '../input.js'
import { PeriodicEstimator } from '../periodic/estimator.js'
import { parseStatusEntries } from '../status-entries.js'
import type { BuffAction } from './combatants.js'
import { ASTROLOGIAN, buff, ENEMY, SAGE, SAMURAI, testCombatants, testDefs } from './periodic.js'

/** The types of the effect entries the inputs keep, with the values of the packets */
export enum AbilityEffectType {
  Damage = 3,
  Heal = 4,
  BlockedDamage = 5,
  ParriedDamage = 6,
}

/** The critical and direct hit bits of an effect entry */
export enum AbilityEffectSeverity {
  Normal = 0,
  Critical = 1,
  Direct = 2,
  DirectCritical = 3,
}

export enum AbilityEffectResultFlag {
  None = 0,
  EffectOnSource = 0x80,
}

/** An effect entry as the packet holds it */
export interface AbilityEffectEntity {
  type: AbilityEffectType
  severity: AbilityEffectSeverity
  flags: AbilityEffectResultFlag
  bonusPercent: number
  param: number
  value: number
}

const RESULTS: Record<AbilityEffectType, HitResult> = {
  [AbilityEffectType.Damage]: 'damage',
  [AbilityEffectType.Heal]: 'heal',
  [AbilityEffectType.BlockedDamage]: 'blocked',
  [AbilityEffectType.ParriedDamage]: 'parried',
}

/** The target of an effect input, as a host makes it from the entries of the packet */
export function effectTarget(
  target: number,
  index: number,
  entities: readonly AbilityEffectEntity[],
  raw: readonly [number, number][] = [],
): EffectTarget {
  return {
    id: target === invalidTarget ? null : target,
    index,
    hits: entities.map((entity) => ({
      result: RESULTS[entity.type],
      amount: entity.value,
      critical: (entity.severity & AbilityEffectSeverity.Critical) !== 0,
      direct: (entity.severity & AbilityEffectSeverity.Direct) !== 0,
      bonusPercent: entity.bonusPercent,
      onSource: (entity.flags & AbilityEffectResultFlag.EffectOnSource) !== 0,
    })),
    applied: parseStatusEntries(raw),
  }
}

/** The statuses input of the changes of a slot */
export function statusesInput(time: number, holder: number, actions: readonly BuffAction[]): CombatInput {
  return {
    type: 'statuses',
    time,
    holder,
    slots: actions.map(({ remove, index, buff }) => ({
      slot: index,
      status: remove ? null : { id: buff.id, source: buff.actorId, stacks: buff.extra },
    })),
    changes: actions.map(({ remove, index, buff }) => ({
      kind: remove ? 'lost' : 'gained',
      slot: index,
      status: buff.id,
      source: buff.actorId,
    })),
  }
}

export const FALL_MALEFIC = 25871
export const HAKAZE = 7477
/** 160, 210 from the rear, 370 in a combo and 420 in a combo from the rear */
export const GEKKO = 7481
/** An ability of the samurai with a potency of 250 */
export const SHINTEN = 7490
export const SLICE = 9
export const COMBUST = { status: 1881, action: 16554 }
export const HIGANBANA = { status: 1228, action: 7489 }
export const HIGH_THUNDER = { status: 3871, action: 36986 }
export const KERAKEIA = { status: 2938, action: 24298 }
export const DIVINATION = 1878
/** Standard Finish on the dancer, and on the partner, which comes without an entry of its own */
export const STANDARD_FINISH = 1821
export const STANDARD_FINISH_PARTNER = 2105
export const BATTLE_LITANY = 786
export const XENOGLOSSY = 16507
export const FIRE_III = 152
export const BLIZZARD_III = 154
export const FIRE = 141
export const DIAGNOSIS = 24284
/** Statuses that tick on their own, and the actions that apply them */
export const SALTED_EARTH = { status: 749, action: 3639 }
export const WILDFIRE = 861
export const WILDFIRE_ACTION = 2878
export const KARDIA = 2604
/** A damage modifier the samurai gives itself, 13% at level 78 and above */
export const FUGETSU = 1298
export const DOSIS = 24283

export const damage = (value: number, severity = AbilityEffectSeverity.Normal): AbilityEffectEntity => ({
  type: AbilityEffectType.Damage,
  severity,
  flags: 0,
  bonusPercent: 0,
  param: 0,
  value,
})
export const heal = (value: number): AbilityEffectEntity => ({ ...damage(value), type: AbilityEffectType.Heal })

/** A raw entry that applies the status, with byte 1 and byte 2 */
export const apply = (status: number, byte1: number, byte2: number, onTarget = true): [number, number] => [
  (onTarget ? 14 : 15) | (byte1 << 8) | (byte2 << 16),
  status << 16,
]

export interface Hit {
  target: number
  entities?: AbilityEffectEntity[]
  raw?: [number, number][]
}

/** Drives an estimator the way the engine does: statuses change the world and come as gains and losses */
export class Harness {
  combatants = testCombatants()
  estimator: PeriodicEstimator
  output: PeriodicTickEvent[] = []
  revisions: PeriodicRevisionEvent[] = []
  time = 10_000
  recorder = SAGE
  private slots = new Map<number, number>()

  constructor(defs = testDefs()) {
    this.estimator = new PeriodicEstimator(defs, this.combatants)
  }

  send(input: CombatInput): this {
    this.output.push(...this.estimator.handleEvent(input))
    return this
  }

  at(time: number): this {
    this.time = time
    return this
  }

  later(milliseconds: number): this {
    this.time += milliseconds
    return this
  }

  base() {
    return { time: this.time }
  }

  /** A zone change the recording player receives */
  zone(territory: number): this {
    return this.send({ type: 'zone', ...this.base(), territory, receiver: this.recorder })
  }

  effect(caster: number, action: number, hits: Hit[]): this {
    return this.send({
      type: 'effect',
      ...this.base(),
      caster,
      action,
      sequence: 1,
      targets: hits.map((hit, index) => effectTarget(hit.target, index, hit.entities ?? [], hit.raw)),
    })
  }

  /** Puts the status on the holder in its next slot, or the slot given, as BuffUpdateEvent would */
  gain(holder: number, status: number, source: number, slot?: number, extra = 0): this {
    const index = slot ?? this.slots.get(holder) ?? 0
    if (slot === undefined) this.slots.set(holder, index + 1)
    const actions = this.combatants.buffUpdate(holder, index, buff(status, source, extra, this.time, 30))
    return actions.length ? this.send(statusesInput(this.time, holder, actions)) : this
  }

  lose(holder: number, slot: number): this {
    const actions = this.combatants.buffUpdate(holder, slot, buff(0, 0))
    return actions.length ? this.send(statusesInput(this.time, holder, actions)) : this
  }

  list(holder: number, statuses: [number, number][]): this {
    return this.send({
      type: 'statusList',
      ...this.base(),
      holder,
      statuses: statuses.map(([id, source]) => ({ id, source })),
    })
  }

  tick(target: number, value: number, isHeal = false, statusId = 0, sourceId = 0): this {
    return this.send({
      type: 'tick',
      ...this.base(),
      target,
      isHeal,
      status: statusId,
      amount: value,
      source: sourceId,
    })
  }

  /** Hits of an action that is not a calibration action, for the rates */
  rateHits(caster: number, critical: number, direct: number, normal: number): this {
    const severities = [
      ...Array(critical).fill(AbilityEffectSeverity.Critical),
      ...Array(direct).fill(AbilityEffectSeverity.Direct),
      ...Array(normal).fill(AbilityEffectSeverity.Normal),
    ]
    for (const severity of severities)
      this.effect(caster, SLICE, [{ target: ENEMY, entities: [damage(1000, severity)] }])
    return this
  }

  /** Ends the battle, as the engine does when the window closes */
  close(): this {
    for (const event of this.estimator.closeBattle(this.time)) {
      if (event.eventType === 'PeriodicTickEvent') this.output.push(event)
      else this.revisions.push(event)
    }
    return this
  }

  last(): PeriodicTickEvent {
    const event = this.output.at(-1)
    if (!event) throw new Error('no tick')
    return event
  }
}

/** The calibration and the rates of the example of design.md */
export function example(harness = new Harness()) {
  for (const amount of [10800, 11070, 10530]) {
    harness.effect(ASTROLOGIAN, FALL_MALEFIC, [{ target: ENEMY, entities: [damage(amount)] }])
  }
  for (const perPotency of [46, 45, 47]) {
    harness.effect(SAMURAI, HAKAZE, [{ target: ENEMY, entities: [damage(perPotency * 200)] }])
  }
  // 20 hits each with the calibration hits: 5 critical and 2 direct, 6 critical and 4 direct
  harness.rateHits(ASTROLOGIAN, 5, 2, 10)
  harness.rateHits(SAMURAI, 6, 4, 7)
  return harness
}

/** Combust III under Divination and Battle Litany, and Higanbana, as in design.md */
export function applyExample(harness: Harness) {
  harness
    .effect(ASTROLOGIAN, 16552, [{ target: ASTROLOGIAN, raw: [apply(DIVINATION, 6, 0, false)] }])
    .gain(ASTROLOGIAN, DIVINATION, ASTROLOGIAN)
    .gain(ASTROLOGIAN, BATTLE_LITANY, SAMURAI)
    .effect(ASTROLOGIAN, COMBUST.action, [{ target: ENEMY, raw: [apply(COMBUST.status, 174, 58)] }])
    .gain(ENEMY, COMBUST.status, ASTROLOGIAN, 0)
    .effect(SAMURAI, HIGANBANA.action, [{ target: ENEMY, raw: [apply(HIGANBANA.status, 6, 250)] }])
    .gain(ENEMY, HIGANBANA.status, SAMURAI, 1)
  return harness
}

export const amounts = (event: PeriodicTickEvent) =>
  event.shares.map((share) => [share.statusId, share.amount, share.basis])
