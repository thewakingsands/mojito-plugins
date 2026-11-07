import { describe, expect, it } from 'vitest'
import type { CombatInput } from '../input.js'
import { ASTROLOGIAN, BLACK_MAGE, DANCER, DANCER_2, ENEMY, SAGE, SAMURAI, testDefs } from '../testing/periodic.js'
import {
  AbilityEffectSeverity,
  AbilityEffectType,
  amounts,
  apply,
  applyExample,
  BATTLE_LITANY,
  BLIZZARD_III,
  COMBUST,
  DIAGNOSIS,
  DIVINATION,
  DOSIS,
  damage,
  example,
  FALL_MALEFIC,
  FIRE,
  FIRE_III,
  FUGETSU,
  GEKKO,
  HAKAZE,
  Harness,
  HIGANBANA,
  HIGH_THUNDER,
  heal,
  KARDIA,
  KERAKEIA,
  SALTED_EARTH,
  SHINTEN,
  STANDARD_FINISH,
  STANDARD_FINISH_PARTNER,
  WILDFIRE,
  WILDFIRE_ACTION,
  XENOGLOSSY,
} from '../testing/periodic-harness.js'
import { roundShares } from './gaussian.js'
import { computePrior } from './prior.js'
import { PRIOR_RATE } from './rates.js'

/** The attributes of the tests at level 100, and their rates */
const CRITICAL_HIT = 3264
const DIRECT_HIT = 2119
const STAT_RATES = { critical: 0.254, direct: 0.336 }

/** Reassembled, which forces critical and direct hits */
const FORCED = 851
/** An action that is not a calibration action */
const SLICE_ACTION = 9
/** Overheated, which adds potency to the weaponskills */
const OVERHEATED = 2688

/** Combust III at level 100, and the last potency of Higanbana, which is also its potency at level 100 */
const COMBUST_POTENCY = 70
const HIGANBANA_POTENCY = 50
const HIGANBANA_LAST = 50

const BOTH: [number, number][] = [
  [COMBUST.status, ASTROLOGIAN],
  [HIGANBANA.status, SAMURAI],
]

/** Combust III and Higanbana on the enemy, without modifiers */
const applyBoth = (harness: Harness) =>
  harness
    .effect(ASTROLOGIAN, COMBUST.action, [{ target: ENEMY, raw: [apply(COMBUST.status, 174, 58)] }])
    .gain(ENEMY, COMBUST.status, ASTROLOGIAN, 0)
    .effect(SAMURAI, HIGANBANA.action, [{ target: ENEMY, raw: [apply(HIGANBANA.status, 6, 250)] }])
    .gain(ENEMY, HIGANBANA.status, SAMURAI, 1)

const zipShares = (values: number[], basis: string) =>
  [COMBUST.status, HIGANBANA.status].map((status, index) => [status, values[index], basis])

/** The amounts of a total in proportion to the weights, as the split rounds them */
const byWeight = (weights: number[], total: number) => {
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0)
  return roundShares(
    weights.map((weight) => (total * weight) / weightSum),
    total,
  )
}

const shareSum = (tick: { shares: { amount: number }[] }) =>
  tick.shares.reduce((total, share) => total + share.amount, 0)

describe('PeriodicEstimator', () => {
  it('splits the confirmed tick of the example', () => {
    const harness = applyExample(example())
    expect(harness.estimator.calibration.perPotency(ASTROLOGIAN, 'damage')).toBe(40)
    expect(harness.estimator.calibration.perPotency(SAMURAI, 'damage')).toBe(46)

    harness.later(1000).tick(ENEMY, 7000)
    expect(harness.output).toEqual([])
    harness.later(20).list(ENEMY, [
      [COMBUST.status, ASTROLOGIAN],
      [HIGANBANA.status, SAMURAI],
    ])
    const tick = harness.last()
    expect(tick.prediction).toBeCloseTo(6396.54, 1)
    expect(tick.confirmed).toBe(true)
    expect(tick.unknown).toBe(0)
    expect(amounts(tick)).toEqual([
      [COMBUST.status, 3983, 'estimated'],
      [HIGANBANA.status, 3017, 'estimated'],
    ])
    expect(tick.shares[0].rates?.critical).toBeCloseTo(6 / 28, 5)
    expect(tick.shares[0].rates?.criticalMultiplier).toBeCloseTo(1.35 + 6 / 28, 5)
    expect(tick.shares[0].snapshot).toEqual([
      { statusId: DIVINATION, sourceId: ASTROLOGIAN, holder: 'caster', type: 'multiplier', value: 1.06 },
      { statusId: BATTLE_LITANY, sourceId: SAMURAI, holder: 'caster', type: 'critical', value: 0.1 },
    ])
    expect(tick.shares[1].snapshot).toEqual([])

    // The update moved the means as in design.md
    harness.later(3000).tick(ENEMY, 7000)
    harness.later(10).list(ENEMY, [
      [COMBUST.status, ASTROLOGIAN],
      [HIGANBANA.status, SAMURAI],
    ])
    expect(harness.last().prediction).toBeCloseTo(3663.23 + 2812.62, 0)
  })

  it('gives a confirmed tick of one source all to it', () => {
    const harness = applyExample(example())
    harness
      .later(1000)
      .tick(ENEMY, 5000)
      .later(10)
      .list(ENEMY, [[COMBUST.status, ASTROLOGIAN]])
    expect(amounts(harness.last())).toEqual([[COMBUST.status, 5000, 'exact']])

    // A second status of the astrologian
    const defs = testDefs(({ statuses, actionTypes }) => {
      statuses.push({
        id: 838,
        periodic: { kind: 'damage', action: 3599, job: 33, potency: [{ level: 1, potency: 50 }] },
      })
      actionTypes.splice(3, 0, { id: 3599, category: 'spell', attackType: 'magic' })
    })
    const second = applyExample(example(new Harness(defs)))
    second
      .effect(ASTROLOGIAN, 3599, [{ target: ENEMY, raw: [apply(838, 10, 10)] }])
      .gain(ENEMY, 838, ASTROLOGIAN, 2)
      .later(1000)
      .tick(ENEMY, 6001)
      .later(10)
      .list(ENEMY, [
        [COMBUST.status, ASTROLOGIAN],
        [838, ASTROLOGIAN],
      ])
    const tick = second.last()
    expect(tick.shares.map((share) => share.basis)).toEqual(['sourceExact', 'sourceExact'])
    expect(tick.shares.reduce((total, share) => total + share.amount, 0)).toBe(6001)
    expect(tick.shares[0].amount).toBeGreaterThan(tick.shares[1].amount)
  })

  describe('unconfirmed ticks', () => {
    it.each([
      ['without a status list', (harness: Harness) => harness.later(200).tick(SAGE, 1, true)],
      ['when the next tick comes first', (harness: Harness) => harness.later(3000).tick(ENEMY, 6000)],
      ['when an event comes more than 100 ms later', (harness: Harness) => harness.later(101).tick(SAGE, 1, true)],
      [
        'when the list has a status without a snapshot',
        (harness: Harness) =>
          harness.later(10).list(ENEMY, [
            [COMBUST.status, ASTROLOGIAN],
            [HIGANBANA.status, SAMURAI],
            [HIGH_THUNDER.status, BLACK_MAGE],
          ]),
      ],
    ])('is unconfirmed %s and leaves the state alone', (_, next) => {
      const harness = applyExample(example())
      harness.later(1000).tick(ENEMY, 9000)
      next(harness)
      const tick = harness.output.find((event) => event.total === 9000)
      expect(tick?.confirmed).toBe(false)
      expect(tick?.shares.map((share) => share.basis)).toEqual(['unconfirmed', 'unconfirmed'])
      expect(tick?.shares.reduce((total, share) => total + share.amount, 0)).toBe(9000)
      // The next prediction is that of the prior: the tick did not update the state
      harness
        .later(3000)
        .tick(ENEMY, 7000)
        .later(10)
        .list(ENEMY, [[COMBUST.status, ASTROLOGIAN]])
      expect(harness.last().prediction).toBeCloseTo(6396.54, 1)
    })
  })

  it('fills the low bytes of a snapshot whose status came before its application', () => {
    const first = applyExample(example())
    const second = example()
    second
      .effect(ASTROLOGIAN, 16552, [{ target: ASTROLOGIAN, raw: [apply(DIVINATION, 6, 0, false)] }])
      .gain(ASTROLOGIAN, DIVINATION, ASTROLOGIAN)
      .gain(ASTROLOGIAN, BATTLE_LITANY, SAMURAI)
      .gain(ENEMY, COMBUST.status, ASTROLOGIAN, 0)
      .later(500)
      .effect(ASTROLOGIAN, COMBUST.action, [{ target: ENEMY, raw: [apply(COMBUST.status, 174, 58)] }])
      .effect(SAMURAI, HIGANBANA.action, [{ target: ENEMY, raw: [apply(HIGANBANA.status, 6, 250)] }])
      .gain(ENEMY, HIGANBANA.status, SAMURAI, 1)
    for (const harness of [first, second]) {
      harness
        .later(1000)
        .tick(ENEMY, 7000)
        .later(10)
        .list(ENEMY, [
          [COMBUST.status, ASTROLOGIAN],
          [HIGANBANA.status, SAMURAI],
        ])
    }
    expect(second.last().prediction).toBeCloseTo(first.last().prediction as number, 6)
  })

  it('takes the byte of the entry for a status whose modifier reads it, in either order', () => {
    for (const statusFirst of [false, true]) {
      const harness = example()
      const divination = () => harness.effect(ASTROLOGIAN, 16552, [{ target: SAMURAI, raw: [apply(DIVINATION, 6, 0)] }])
      if (statusFirst) harness.gain(SAMURAI, DIVINATION, ASTROLOGIAN).later(100)
      divination()
      if (!statusFirst) harness.later(100).gain(SAMURAI, DIVINATION, ASTROLOGIAN)
      harness
        .effect(SAMURAI, HIGANBANA.action, [{ target: ENEMY, raw: [apply(HIGANBANA.status, 6, 250)] }])
        .gain(ENEMY, HIGANBANA.status, SAMURAI, 0)
        .later(1000)
        .tick(ENEMY, 3000)
        .later(10)
        .list(ENEMY, [[HIGANBANA.status, SAMURAI]])
      expect(harness.last().shares[0].snapshot).toEqual([
        { statusId: DIVINATION, sourceId: ASTROLOGIAN, holder: 'caster', type: 'multiplier', value: 1.06 },
      ])
    }
  })

  describe('a status that takes the byte of another status of its source', () => {
    /** The Standard Finish of the dancer, whose entry is on the dancer only, as in the recordings */
    const finish = (harness: Harness, dancer = DANCER, byte = 5) =>
      harness.effect(dancer, 16192, [{ target: dancer, raw: [apply(STANDARD_FINISH, byte, 0)] }])
    /** The factor the Standard Finish of the partner gives a hit of the partner; undefined without one */
    const partnerFactor = (harness: Harness, partner = SAMURAI) =>
      harness.estimator.modifiers
        .compute({ kind: 'damage', caster: partner, target: ENEMY, action: harness.estimator.actionInfo(HAKAZE) })
        .effects.find((effect) => effect.statusId === STANDARD_FINISH_PARTNER)

    it('takes the byte of the dancer when the partner gains it after the entry', () => {
      const harness = new Harness()
      finish(harness).gain(DANCER, STANDARD_FINISH, DANCER).later(100).gain(SAMURAI, STANDARD_FINISH_PARTNER, DANCER)
      expect(partnerFactor(harness)).toEqual({
        statusId: STANDARD_FINISH_PARTNER,
        sourceId: DANCER,
        holder: 'caster',
        type: 'multiplier',
        value: 1.05,
      })
    })

    it('takes the byte of an entry that comes after the partner gains it, within the window', () => {
      const harness = new Harness()
      harness.gain(SAMURAI, STANDARD_FINISH_PARTNER, DANCER).later(100)
      finish(harness)
      expect(partnerFactor(harness)?.value).toBeCloseTo(1.05, 12)

      const late = new Harness()
      late.gain(SAMURAI, STANDARD_FINISH_PARTNER, DANCER).later(3001)
      finish(late)
      expect(partnerFactor(late)).toBeUndefined()
    })

    it('keeps the byte after the dancer loses the status', () => {
      const harness = new Harness()
      finish(harness).gain(DANCER, STANDARD_FINISH, DANCER, 0).gain(SAMURAI, STANDARD_FINISH_PARTNER, DANCER)
      harness.later(1000).lose(DANCER, 0)
      expect(partnerFactor(harness)?.value).toBeCloseTo(1.05, 12)
    })

    it('takes the byte of its own entry when it has one', () => {
      const harness = new Harness()
      finish(harness)
        .gain(DANCER, STANDARD_FINISH, DANCER)
        .effect(DANCER, 16192, [{ target: SAMURAI, raw: [apply(STANDARD_FINISH_PARTNER, 2, 0)] }])
        .gain(SAMURAI, STANDARD_FINISH_PARTNER, DANCER)
      expect(partnerFactor(harness)?.value).toBeCloseTo(1.02, 12)
    })

    it('takes the byte of its own dancer', () => {
      const harness = new Harness()
      finish(harness, DANCER, 5).gain(DANCER, STANDARD_FINISH, DANCER)
      finish(harness, DANCER_2, 2).gain(DANCER_2, STANDARD_FINISH, DANCER_2)
      harness.gain(SAMURAI, STANDARD_FINISH_PARTNER, DANCER).gain(BLACK_MAGE, STANDARD_FINISH_PARTNER, DANCER_2)
      expect(partnerFactor(harness, SAMURAI)).toMatchObject({ sourceId: DANCER, value: 1.05 })
      expect(partnerFactor(harness, BLACK_MAGE)).toMatchObject({ sourceId: DANCER_2, value: 1.02 })
    })
  })

  it('replaces the byte when a refresh brings a new one', () => {
    const harness = example()
    harness
      .effect(ASTROLOGIAN, 16552, [{ target: SAMURAI, raw: [apply(DIVINATION, 6, 0)] }])
      .gain(SAMURAI, DIVINATION, ASTROLOGIAN, 0)
      .later(10_000)
      .effect(ASTROLOGIAN, 16552, [{ target: SAMURAI, raw: [apply(DIVINATION, 4, 0)] }])
      .gain(SAMURAI, DIVINATION, ASTROLOGIAN, 0)
      .effect(SAMURAI, HIGANBANA.action, [{ target: ENEMY, raw: [apply(HIGANBANA.status, 6, 250)] }])
      .gain(ENEMY, HIGANBANA.status, SAMURAI, 0)
      .later(1000)
      .tick(ENEMY, 3000)
      .later(10)
      .list(ENEMY, [[HIGANBANA.status, SAMURAI]])
    expect(harness.last().shares[0].snapshot[0].value).toBeCloseTo(1.04, 12)
  })

  it('takes a new snapshot on a refresh with an application, and keeps the old one without', () => {
    const harness = applyExample(example())
    // A refresh of Combust III without Divination
    harness.lose(ASTROLOGIAN, 0)
    harness.later(5000).effect(ASTROLOGIAN, COMBUST.action, [{ target: ENEMY, raw: [apply(COMBUST.status, 100, 58)] }])
    harness.gain(ENEMY, COMBUST.status, ASTROLOGIAN, 0)
    harness
      .later(1000)
      .tick(ENEMY, 5000)
      .later(10)
      .list(ENEMY, [[COMBUST.status, ASTROLOGIAN]])
    expect(harness.last().shares[0].snapshot.map((item) => item.statusId)).toEqual([BATTLE_LITANY])

    // A refresh the estimator saw no application of keeps the snapshot
    harness.later(5000).gain(ENEMY, COMBUST.status, ASTROLOGIAN, 0)
    harness
      .later(1000)
      .tick(ENEMY, 5000)
      .later(10)
      .list(ENEMY, [[COMBUST.status, ASTROLOGIAN]])
    expect(harness.last().shares[0].snapshot.map((item) => item.statusId)).toEqual([BATTLE_LITANY])
  })

  it('splits the tick by potency until the caster has samples, then gives the snapshot a prior', () => {
    const harness = new Harness()
    applyBoth(harness).later(1000).tick(ENEMY, 7000).later(10).list(ENEMY, BOTH)
    const tick = harness.last()
    expect(tick).toMatchObject({ prediction: null, unknown: 0 })
    expect(amounts(tick)).toEqual(zipShares(byWeight([COMBUST_POTENCY, HIGANBANA_POTENCY], 7000), 'estimated'))
    expect(shareSum(tick)).toBe(7000)

    example(harness)
    harness
      .later(3000)
      .tick(ENEMY, 7000)
      .later(10)
      .list(ENEMY, [
        [COMBUST.status, ASTROLOGIAN],
        [HIGANBANA.status, SAMURAI],
      ])
    expect(harness.last().prediction).not.toBeNull()
    expect(harness.last().shares).toHaveLength(2)
  })

  describe('without priors for every member', () => {
    /** The astrologian calibrates on Fall Malefic to ρ 40; the samurai does not */
    const calibrateAstrologian = (harness: Harness) => {
      for (const amount of [10800, 11070, 10530]) {
        harness.effect(ASTROLOGIAN, FALL_MALEFIC, [{ target: ENEMY, entities: [damage(amount)] }])
      }
      return harness
    }

    /** μ of a snapshot of the test: ρ 40 and no modifiers */
    const mean = (harness: Harness, caster: number, potency: number, lowByte: number, critByte: number) => {
      const { critical, direct } = harness.estimator.ratesOf(caster)
      return computePrior({
        kind: 'damage',
        base: 40 * potency,
        lowByte,
        critByte,
        critical,
        direct,
        critDelta: 0,
        directDelta: 0,
      }).mean
    }

    it('weighs the member without a prior by the ρ of another caster', () => {
      const harness = applyBoth(calibrateAstrologian(new Harness()))
      harness.later(1000).tick(ENEMY, 7000).later(10).list(ENEMY, BOTH)
      const tick = harness.last()
      const weights = [
        mean(harness, ASTROLOGIAN, COMBUST_POTENCY, 174, 58),
        mean(harness, SAMURAI, HIGANBANA_POTENCY, 6, 250),
      ]
      expect(tick).toMatchObject({ prediction: null, unknown: 0, confirmed: true })
      expect(amounts(tick)).toEqual(zipShares(byWeight(weights, 7000), 'estimated'))
      expect(shareSum(tick)).toBe(7000)
    })

    it('takes the last potency of the table at an unknown level', () => {
      const harness = new Harness()
      harness.combatants.update(SAMURAI, { level: 0 })
      applyBoth(calibrateAstrologian(harness))
      harness.later(1000).tick(ENEMY, 7000).later(10).list(ENEMY, BOTH)
      const tick = harness.last()
      const weights = [
        mean(harness, ASTROLOGIAN, COMBUST_POTENCY, 174, 58),
        mean(harness, SAMURAI, HIGANBANA_LAST, 6, 250),
      ]
      expect(tick.unknown).toBe(0)
      expect(amounts(tick)).toEqual(zipShares(byWeight(weights, 7000), 'estimated'))
      expect(tick.shares.every((share) => share.amount > 0)).toBe(true)
      expect(shareSum(tick)).toBe(7000)
    })

    it('weighs by potency and multiplier when no caster has ρ', () => {
      const harness = new Harness()
      harness.combatants.update(SAMURAI, { level: 0 })
      applyBoth(harness).later(1000).tick(ENEMY, 7000).later(10).list(ENEMY, BOTH)
      const tick = harness.last()
      expect(tick.unknown).toBe(0)
      expect(amounts(tick)).toEqual(zipShares(byWeight([COMBUST_POTENCY, HIGANBANA_LAST], 7000), 'estimated'))
    })

    it('splits an unconfirmed tick the same way', () => {
      const harness = applyBoth(calibrateAstrologian(new Harness()))
      harness.later(1000).tick(ENEMY, 7000).later(200).tick(SAGE, 1, true)
      const tick = harness.last()
      expect(tick).toMatchObject({ combatant: ENEMY, confirmed: false, unknown: 0 })
      expect(tick.shares.map((share) => share.basis)).toEqual(['unconfirmed', 'unconfirmed'])
      expect(shareSum(tick)).toBe(7000)
    })

    it('splits a tick of one source by potency at an unknown level', () => {
      const defs = testDefs(({ statuses, actionTypes }) => {
        statuses.push({
          id: 838,
          periodic: { kind: 'damage', action: 3599, job: 33, potency: [{ level: 1, potency: 50 }] },
        })
        actionTypes.splice(3, 0, { id: 3599, category: 'spell', attackType: 'magic' })
      })
      const harness = new Harness(defs)
      harness.combatants.update(ASTROLOGIAN, { level: 0 })
      applyExample(harness)
        .effect(ASTROLOGIAN, 3599, [{ target: ENEMY, raw: [apply(838, 10, 10)] }])
        .gain(ENEMY, 838, ASTROLOGIAN, 2)
        .later(1000)
        .tick(ENEMY, 6001)
        .later(10)
        .list(ENEMY, [
          [COMBUST.status, ASTROLOGIAN],
          [838, ASTROLOGIAN],
        ])
      const tick = harness.last()
      // Both snapshots take Divination, 1.06
      const weights = [COMBUST_POTENCY * 1.06, 50 * 1.06]
      expect(tick.unknown).toBe(0)
      expect(tick.shares.map((share) => share.basis)).toEqual(['sourceExact', 'sourceExact'])
      expect(tick.shares.map((share) => share.amount)).toEqual(byWeight(weights, 6001))
    })

    it('leaves the state as it was', () => {
      const split = applyBoth(calibrateAstrologian(new Harness()))
      const skipped = applyBoth(calibrateAstrologian(new Harness()))
      split.later(1000).tick(ENEMY, 7000).later(10).list(ENEMY, BOTH)
      skipped.later(1010)
      for (const harness of [split, skipped]) {
        for (const perPotency of [46, 45, 47]) {
          harness.effect(SAMURAI, HAKAZE, [{ target: ENEMY, entities: [damage(perPotency * 200)] }])
        }
        harness.later(3000).tick(ENEMY, 7000).later(10).list(ENEMY, BOTH)
      }
      expect(split.last().prediction).not.toBeNull()
      expect(split.last().prediction).toBe(skipped.last().prediction)
    })
  })

  describe('black mages', () => {
    /** The amount of a hit of the black mage for a ρ of 50 */
    const amount = (potency: number, factor: number, multiplier: number) =>
      Math.round(50 * potency * factor * multiplier)

    it('takes no sample before the elements are known, and leaves them out of the snapshot', () => {
      const harness = new Harness()
      harness.effect(BLACK_MAGE, XENOGLOSSY, [{ target: ENEMY, entities: [damage(44500)] }])
      expect(harness.estimator.calibration.count(BLACK_MAGE, 'damage')).toBe(0)

      // Unknown before Fire III: High Thunder without Enochian
      harness.effect(BLACK_MAGE, HIGH_THUNDER.action, [{ target: ENEMY, raw: [apply(HIGH_THUNDER.status, 1, 1)] }])
      harness.gain(ENEMY, HIGH_THUNDER.status, BLACK_MAGE, 0)

      // Fire III resolves before the change: no sample, then three stacks of Astral Fire
      harness.effect(BLACK_MAGE, FIRE_III, [{ target: ENEMY, entities: [damage(1)] }])
      expect(harness.estimator.calibration.count(BLACK_MAGE, 'damage')).toBe(0)
      harness.effect(BLACK_MAGE, XENOGLOSSY, [{ target: ENEMY, entities: [damage(amount(890, 1, 1.27))] }])
      harness.effect(BLACK_MAGE, FIRE, [{ target: ENEMY, entities: [damage(amount(180, 1.8, 1.27))] }])
      // Blizzard III at three stacks of Astral Fire, which then become Umbral Ice
      harness.effect(BLACK_MAGE, BLIZZARD_III, [{ target: ENEMY, entities: [damage(amount(290, 0.7, 1.27))] }])
      expect(harness.estimator.elements.stateOf(BLACK_MAGE)?.elementStance).toBe(-3)
      expect(harness.estimator.calibration.perPotency(BLACK_MAGE, 'damage')).toBeCloseTo(50, 2)

      harness
        .later(1000)
        .tick(ENEMY, 3000)
        .later(10)
        .list(ENEMY, [[HIGH_THUNDER.status, BLACK_MAGE]])
      expect(harness.last().shares).toEqual([
        expect.objectContaining({ statusId: HIGH_THUNDER.status, amount: 3000, basis: 'exact' }),
      ])
      // The snapshot was taken while the elements were unknown: no Enochian
      expect(harness.estimator.battleTicks.at(-1)?.members[0].multiplier).toBe(1)
    })

    it('uses the gauge of the recording player once it came', () => {
      const harness = new Harness()
      harness.recorder = BLACK_MAGE
      const gauge = (elementStance: number): CombatInput => ({
        type: 'gauge',
        ...harness.base(),
        actor: BLACK_MAGE,
        gauge: { job: 'BlackMage', elementStance, enochianActive: elementStance !== 0 },
      })
      // Before the gauge of the zone, the inferred state counts
      harness.effect(BLACK_MAGE, FIRE_III, [{ target: ENEMY, entities: [damage(1)] }])
      harness.effect(BLACK_MAGE, FIRE, [{ target: ENEMY, entities: [damage(amount(180, 1.8, 1.27))] }])
      expect(harness.estimator.calibration.perPotency(BLACK_MAGE, 'damage')).toBeCloseTo(50, 2)

      // The gauge says Umbral Ice; the inference still says Astral Fire
      harness.send(gauge(-3))
      harness.effect(BLACK_MAGE, FIRE, [{ target: ENEMY, entities: [damage(amount(180, 0.7, 1.27))] }])
      expect(harness.estimator.calibration.perPotency(BLACK_MAGE, 'damage')).toBeCloseTo(50, 2)
      // A gauge after the effect of an action does not change its sample
      harness.effect(BLACK_MAGE, BLIZZARD_III, [{ target: ENEMY, entities: [damage(amount(290, 1, 1.27))] }])
      harness.send(gauge(3))
      expect(harness.estimator.calibration.perPotency(BLACK_MAGE, 'damage')).toBeCloseTo(50, 2)
    })

    it('calibrates a black mage synced below Xenoglossy with the fire and ice spells', () => {
      const harness = new Harness()
      harness.combatants.update(BLACK_MAGE, { level: 60 })
      harness.effect(BLACK_MAGE, FIRE_III, [{ target: ENEMY, entities: [damage(1)] }])
      // level 60: Enochian adds 5%
      harness.effect(BLACK_MAGE, FIRE, [{ target: ENEMY, entities: [damage(amount(180, 1.8, 1.05))] }])
      expect(harness.estimator.calibration.perPotency(BLACK_MAGE, 'damage')).toBeCloseTo(50, 2)
      harness.effect(BLACK_MAGE, HIGH_THUNDER.action, [{ target: ENEMY, raw: [apply(HIGH_THUNDER.status, 1, 1)] }])
      harness.gain(ENEMY, HIGH_THUNDER.status, BLACK_MAGE, 0)
      harness.later(1000).tick(ENEMY, 3000)
      expect(harness.estimator.battleTicks).toHaveLength(0)
      harness.later(10).list(ENEMY, [[HIGH_THUNDER.status, BLACK_MAGE]])
      expect(harness.last().prediction).not.toBeNull()
      expect(harness.estimator.battleTicks.at(-1)?.members[0].multiplier).toBeCloseTo(1.05, 12)
    })
  })

  it('takes the calibration of the job of the caster', () => {
    // Second Wind: 800 for the samurai, 500 for the sage; the astrologian has none
    const defs = testDefs(({ actions, actionTypes }) => {
      actionTypes.splice(7, 0, { id: 7541, category: 'ability', attackType: null })
      for (const [job, potency] of [
        [34, 800],
        [40, 500],
      ]) {
        actions.push({
          id: 7541,
          job,
          calibration: { kind: 'heal', potency: [{ level: 1, potency }] },
        })
      }
    })
    const harness = new Harness(defs)
    harness.effect(SAMURAI, 7541, [{ target: SAMURAI, entities: [heal(80000)] }])
    harness.effect(SAGE, 7541, [{ target: SAGE, entities: [heal(80000)] }])
    harness.effect(ASTROLOGIAN, 7541, [{ target: ASTROLOGIAN, entities: [heal(80000)] }])
    expect(harness.estimator.calibration.perPotency(SAMURAI, 'heal')).toBe(100)
    expect(harness.estimator.calibration.perPotency(SAGE, 'heal')).toBe(160)
    expect(harness.estimator.calibration.perPotency(ASTROLOGIAN, 'heal')).toBeNull()
  })

  it('hands a tick of its own status on as exact', () => {
    const harness = new Harness()
    harness.tick(ENEMY, 1234, false, WILDFIRE, SAMURAI)
    expect(harness.last()).toMatchObject({
      statusId: WILDFIRE,
      total: 1234,
      unknown: 0,
      shares: [
        {
          statusId: WILDFIRE,
          sourceId: SAMURAI,
          amount: 1234,
          basis: 'exact',
          snapshot: [],
          rates: { critical: 0.125, direct: 0.125, criticalMultiplier: 1.475 },
        },
      ],
    })

    harness.tick(SAMURAI, 1000, true, KARDIA, SAGE)
    expect(harness.last().shares[0]).toMatchObject({ snapshot: [], rates: null })
  })

  describe('a damage tick of its own status', () => {
    const fugetsu = (value: number) => ({
      statusId: FUGETSU,
      sourceId: SAMURAI,
      holder: 'caster',
      type: 'multiplier',
      value,
    })
    const vulnerability = { statusId: 3849, sourceId: ASTROLOGIAN, holder: 'target', type: 'multiplier', value: 1.05 }

    it('takes the modifiers of the caster when the status was applied', () => {
      const harness = new Harness()
      harness
        .effect(SAMURAI, SALTED_EARTH.action, [{ target: SAMURAI, raw: [apply(SALTED_EARTH.status, 0, 0, false)] }])
        .gain(SAMURAI, FUGETSU, SAMURAI, 0)
        .later(3000)
        .tick(ENEMY, 1234, false, SALTED_EARTH.status, SAMURAI)
      // Fugetsu came after the application; the enemy was not a target of it, so its modifiers are those of now
      expect(harness.last().shares[0].snapshot).toEqual([])

      harness.gain(ENEMY, 3849, ASTROLOGIAN, 0).later(3000).tick(ENEMY, 1234, false, SALTED_EARTH.status, SAMURAI)
      expect(harness.last().shares[0].snapshot).toEqual([vulnerability])

      // Fugetsu is on the samurai when the next application comes, and is gone at the tick
      harness
        .effect(SAMURAI, SALTED_EARTH.action, [{ target: SAMURAI, raw: [apply(SALTED_EARTH.status, 0, 0, false)] }])
        .lose(SAMURAI, 0)
        .later(3000)
        .tick(ENEMY, 1234, false, SALTED_EARTH.status, SAMURAI)
      expect(harness.last().shares[0].snapshot).toEqual([fugetsu(1.13), vulnerability])
    })

    it('takes the modifiers of a target of the application as they were then', () => {
      const harness = new Harness()
      harness
        .gain(ENEMY, 3849, ASTROLOGIAN, 0)
        .effect(SAMURAI, WILDFIRE_ACTION, [{ target: ENEMY, raw: [apply(WILDFIRE, 0, 0)] }])
        .lose(ENEMY, 0)
        .later(10_000)
        .tick(ENEMY, 1234, false, WILDFIRE, SAMURAI)
      expect(harness.last().shares[0].snapshot).toEqual([vulnerability])
    })

    it('forgets the applications when the zone changes', () => {
      const harness = new Harness()
      harness
        .gain(SAMURAI, FUGETSU, SAMURAI, 0)
        .effect(SAMURAI, WILDFIRE_ACTION, [{ target: ENEMY, raw: [apply(WILDFIRE, 0, 0)] }])
        .zone(1)
        .tick(ENEMY, 1234, false, WILDFIRE, SAMURAI)
      expect(harness.last().shares[0].snapshot).toEqual([])
    })
  })

  it('has no shares for a combatant without statuses', () => {
    const harness = new Harness()
    harness
      .tick(ENEMY, 1234)
      .later(10)
      .list(ENEMY, [[49, SAMURAI]])
    expect(harness.last()).toMatchObject({ unknown: 1234, shares: [], confirmed: false, prediction: null })
  })

  it('splits the heals of the sage', () => {
    const harness = new Harness()
    for (const value of [45000, 45000]) harness.effect(SAGE, DIAGNOSIS, [{ target: SAMURAI, entities: [heal(value)] }])
    harness.effect(SAGE, DOSIS, [{ target: ENEMY, entities: [damage(33000)] }])
    harness.effect(SAGE, KERAKEIA.action, [{ target: SAMURAI, raw: [apply(KERAKEIA.status, 0, 0)] }])
    harness.gain(SAMURAI, KERAKEIA.status, SAGE, 0)
    harness
      .later(1000)
      .tick(SAMURAI, 10000, true)
      .later(10)
      .list(SAMURAI, [[KERAKEIA.status, SAGE]])
    expect(amounts(harness.last())).toEqual([[KERAKEIA.status, 10000, 'exact']])
    // ρ is 100 per potency; the hit of Dosis makes ĉ (0 + 1) / (1 + 8)
    const critical = 1 / 9
    expect(harness.last().prediction).toBeCloseTo(100 * 100 * (1 + critical * (1.35 + critical - 1)), 1)
  })

  it('hands the pending ticks on and forgets everything when the zone changes', () => {
    const harness = applyExample(example())
    harness.later(1000).tick(ENEMY, 7000)
    harness.zone(1)
    expect(harness.last()).toMatchObject({ total: 7000, confirmed: false })
    expect(harness.estimator.calibration.count(ASTROLOGIAN, 'damage')).toBe(0)
    harness
      .later(1000)
      .tick(ENEMY, 7000)
      .later(10)
      .list(ENEMY, [[COMBUST.status, ASTROLOGIAN]])
    expect(harness.last()).toMatchObject({ unknown: 7000, shares: [] })
  })

  describe('potency samples', () => {
    it('takes a sample of a hit on the first target, and the calibration of one neither critical nor direct', () => {
      const harness = new Harness()
      harness
        .effect(ASTROLOGIAN, 16552, [{ target: SAMURAI, raw: [apply(DIVINATION, 6, 0)] }])
        .gain(SAMURAI, DIVINATION, ASTROLOGIAN)
        .effect(SAMURAI, HAKAZE, [{ target: ENEMY, entities: [damage(9540)] }])
      const samples = harness.estimator.takeSamples()
      expect(samples).toEqual([
        {
          eventType: 'PotencySampleEvent',
          eventTime: harness.time,
          caster: SAMURAI,
          target: ENEMY,
          action: HAKAZE,
          sequence: 1,
          amount: 9540,
          potency: 200,
          multiplier: 1.06,
          factors: [{ statusId: DIVINATION, sourceId: ASTROLOGIAN, holder: 'caster', value: 1.06 }],
          critical: false,
          direct: false,
        },
      ])
      // The same values the calibration took
      expect(harness.estimator.calibration.perPotency(SAMURAI, 'damage')).toBeCloseTo(9540 / 200 / 1.06, 9)
      expect(harness.estimator.takeSamples()).toEqual([])
    })

    it('marks the critical and direct hits, which the calibration leaves out', () => {
      const harness = new Harness()
      const both = AbilityEffectSeverity.Critical | AbilityEffectSeverity.Direct
      harness.effect(SAMURAI, HAKAZE, [{ target: ENEMY, entities: [damage(14000, AbilityEffectSeverity.Critical)] }])
      harness.effect(SAMURAI, HAKAZE, [{ target: ENEMY, entities: [damage(11250, AbilityEffectSeverity.Direct)] }])
      harness.effect(SAMURAI, HAKAZE, [{ target: ENEMY, entities: [damage(17500, both)] }])
      expect(
        harness.estimator.takeSamples().map(({ amount, potency, critical, direct }) => ({
          amount,
          potency,
          critical,
          direct,
        })),
      ).toEqual([
        { amount: 14000, potency: 200, critical: true, direct: false },
        { amount: 11250, potency: 200, critical: false, direct: true },
        { amount: 17500, potency: 200, critical: true, direct: true },
      ])
      expect(harness.estimator.calibration.perPotency(SAMURAI, 'damage')).toBeNull()
    })

    it('takes the potency of the combo and the positional from the bonus percentage', () => {
      const harness = new Harness()
      const hit = (bonusPercent: number) =>
        harness.effect(SAMURAI, GEKKO, [{ target: ENEMY, entities: [{ ...damage(9000), bonusPercent }] }])
      for (const bonusPercent of [0, 23, 56, 61, 30]) hit(bonusPercent)
      expect(harness.estimator.takeSamples().map((sample) => sample.potency)).toEqual([160, 210, 370, 420])
    })

    it('leaves out the forced and blocked hits, the other targets and the other actions', () => {
      const harness = new Harness()
      harness.effect(SAMURAI, SLICE_ACTION, [{ target: ENEMY, entities: [damage(9000)] }])
      harness.effect(SAMURAI, HAKAZE, [
        { target: ENEMY, entities: [damage(9000, AbilityEffectSeverity.Critical)] },
        { target: ENEMY, entities: [damage(9000)] },
      ])
      expect(harness.estimator.takeSamples().map((sample) => sample.critical)).toEqual([true])
      harness.effect(SAMURAI, HAKAZE, [
        { target: ENEMY, entities: [{ ...damage(9000), type: AbilityEffectType.BlockedDamage }] },
      ])
      harness.effect(SAMURAI, HAKAZE, [
        { target: ENEMY, entities: [{ ...damage(9000), type: AbilityEffectType.ParriedDamage }] },
      ])
      expect(harness.estimator.takeSamples()).toEqual([])
      harness.gain(SAMURAI, FORCED, SAMURAI)
      harness.effect(SAMURAI, HAKAZE, [{ target: ENEMY, entities: [damage(9000)] }])
      expect(harness.estimator.takeSamples()).toEqual([])
    })

    it('leaves out the hits that a status of the caster adds potency to', () => {
      const harness = new Harness()
      harness.gain(SAMURAI, OVERHEATED, SAMURAI)
      harness.effect(SAMURAI, HAKAZE, [{ target: ENEMY, entities: [damage(9000)] }])
      harness.effect(SAMURAI, SHINTEN, [{ target: ENEMY, entities: [damage(11250)] }])
      expect(harness.estimator.takeSamples().map((sample) => [sample.action, sample.potency])).toEqual([[SHINTEN, 250]])
      // The calibration does not read the status
      expect(harness.estimator.calibration.perPotency(SAMURAI, 'damage')).toBe(45)
    })

    it('takes the samples of the job of the caster only', () => {
      const harness = new Harness()
      harness.effect(ASTROLOGIAN, HAKAZE, [{ target: ENEMY, entities: [damage(9000)] }])
      expect(harness.estimator.takeSamples()).toEqual([])
    })

    it('takes no sample of a heal, at an unknown level, or of a black mage of unknown elements', () => {
      const harness = new Harness()
      harness.effect(SAGE, DIAGNOSIS, [{ target: SAGE, entities: [heal(45000)] }])
      harness.effect(BLACK_MAGE, XENOGLOSSY, [{ target: ENEMY, entities: [damage(44500)] }])
      harness.combatants.update(SAMURAI, { level: 0 })
      harness.effect(SAMURAI, HAKAZE, [{ target: ENEMY, entities: [damage(9000)] }])
      expect(harness.estimator.takeSamples()).toEqual([])
    })

    it('forgets the samples when the zone changes', () => {
      const harness = new Harness()
      harness.effect(SAMURAI, HAKAZE, [{ target: ENEMY, entities: [damage(9000)] }])
      harness.zone(1)
      expect(harness.estimator.takeSamples()).toEqual([])
    })
  })

  describe('ratesOf', () => {
    const withStats = (harness = new Harness()) => {
      harness.estimator.setPlayerStats(ASTROLOGIAN, CRITICAL_HIT, DIRECT_HIT)
      return harness
    }

    it('takes the rates of the player from the attributes, and of the others from the samples', () => {
      const harness = withStats().rateHits(ASTROLOGIAN, 5, 2, 10).rateHits(SAMURAI, 6, 4, 7)
      expect(harness.estimator.ratesOf(ASTROLOGIAN)).toEqual(STAT_RATES)
      expect(harness.estimator.ratesOf(SAMURAI)).toEqual(harness.estimator.rates.rates(SAMURAI))
    })

    it('still collects the samples of the player', () => {
      const harness = withStats().rateHits(ASTROLOGIAN, 5, 2, 10)
      expect(harness.estimator.rates.rates(ASTROLOGIAN).critical).toBeGreaterThan(PRIOR_RATE)
      expect(harness.estimator.ratesOf(ASTROLOGIAN)).toEqual(STAT_RATES)
    })

    it('takes the samples without attributes', () => {
      const harness = new Harness().rateHits(ASTROLOGIAN, 5, 2, 10)
      expect(harness.estimator.ratesOf(ASTROLOGIAN)).toEqual(harness.estimator.rates.rates(ASTROLOGIAN))
    })

    it.each([0, 101])('takes the samples at level %i, which has no modifiers', (level) => {
      const harness = withStats().rateHits(ASTROLOGIAN, 5, 2, 10)
      harness.combatants.update(ASTROLOGIAN, { level })
      expect(harness.estimator.ratesOf(ASTROLOGIAN)).toEqual(harness.estimator.rates.rates(ASTROLOGIAN))
    })

    it.each([
      [419, DIRECT_HIT],
      [CRITICAL_HIT, 419],
    ])('takes the samples with the attributes %i and %i below the base', (criticalHit, directHit) => {
      const harness = new Harness().rateHits(ASTROLOGIAN, 5, 2, 10)
      harness.estimator.setPlayerStats(ASTROLOGIAN, criticalHit, directHit)
      expect(harness.estimator.ratesOf(ASTROLOGIAN)).toEqual(harness.estimator.rates.rates(ASTROLOGIAN))
    })

    it('takes the latest attributes', () => {
      const harness = withStats()
      harness.estimator.setPlayerStats(ASTROLOGIAN, 434, 426)
      expect(harness.estimator.ratesOf(ASTROLOGIAN)).toEqual({ critical: 0.051, direct: 0.001 })
    })

    it('keeps the attributes when the zone changes, and forgets the samples', () => {
      const harness = withStats().rateHits(ASTROLOGIAN, 5, 2, 10)
      harness.zone(1)
      expect(harness.estimator.rates.rates(ASTROLOGIAN)).toEqual({ critical: PRIOR_RATE, direct: PRIOR_RATE })
      expect(harness.estimator.ratesOf(ASTROLOGIAN)).toEqual(STAT_RATES)
    })

    it('gives the rates of the attributes to the priors of the snapshots and to the shares of a tick', () => {
      const predicted = (harness: Harness) => {
        applyExample(example(harness)).later(1000).tick(ENEMY, 7000)
        harness.later(20).list(ENEMY, [
          [COMBUST.status, ASTROLOGIAN],
          [HIGANBANA.status, SAMURAI],
        ])
        return harness.last()
      }
      const samples = new Harness()
      const fromSamples = predicted(samples)
      const tick = predicted(withStats())

      expect(tick.shares[0].rates).toEqual({ ...STAT_RATES, criticalMultiplier: expect.closeTo(1.35 + 0.254, 12) })
      expect(tick.shares[1].rates).toEqual(fromSamples.shares[1].rates)

      // Only the prior of Combust III changes
      const combust = { kind: 'damage', base: 40 * 70 * 1.06, lowByte: 174, critByte: 58, critDelta: 0.1 } as const
      const mean = (rates: { critical: number; direct: number }) =>
        computePrior({ ...combust, ...rates, directDelta: 0 }).mean
      expect((tick.prediction ?? 0) - (fromSamples.prediction ?? 0)).toBeCloseTo(
        mean(STAT_RATES) - mean(samples.estimator.rates.rates(ASTROLOGIAN)),
        6,
      )
    })

    it('gives the rates of the attributes to the share of a tick of its own status', () => {
      const harness = withStats()
      harness
        .effect(ASTROLOGIAN, SALTED_EARTH.action, [
          { target: ASTROLOGIAN, raw: [apply(SALTED_EARTH.status, 0, 0, false)] },
        ])
        .later(3000)
        .tick(ENEMY, 1000, false, SALTED_EARTH.status, ASTROLOGIAN)
      expect(harness.last().shares[0].rates).toEqual({
        ...STAT_RATES,
        criticalMultiplier: expect.closeTo(1.35 + 0.254, 12),
      })
    })
  })
})
