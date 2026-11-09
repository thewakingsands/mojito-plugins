import { describe, expect, it } from 'vitest'
import type { DamageAttributionEvent, PeriodicRevisionEvent } from '../events.js'
import type { CombatInput } from '../input.js'
import { criticalMultiplierOf } from '../periodic/prior.js'
import { ASTROLOGIAN, ENEMY, SAGE, SAMURAI, testDefs } from '../testing/periodic.js'
import {
  AbilityEffectResultFlag,
  AbilityEffectSeverity,
  apply,
  applyExample,
  BATTLE_LITANY,
  COMBUST,
  DIVINATION,
  damage,
  example,
  FALL_MALEFIC,
  FUGETSU,
  HAKAZE,
  Harness,
  HIGANBANA,
  SALTED_EARTH,
} from '../testing/periodic-harness.js'
import { DamageAttributor } from './attributor.js'
import { attribute } from './kernel.js'

const PET = 0x40000010
const ENEMY_2 = 0x40000002
const DIVINATION_SHARE = 1 - 1 / 1.06
const BRAVER = 200

/** A harness whose attributor reads what the estimator reads and gives back */
class AttributionHarness extends Harness {
  attributor = new DamageAttributor(this.estimator, this.combatants)
  splits: DamageAttributionEvent[] = []

  constructor(defs = testDefs()) {
    super(defs)
    this.combatants.update(PET, { bNpcBase: 10490, ownerId: SAMURAI }, true)
    this.combatants.update(ENEMY_2, { bNpcBase: 541 }, true)
  }

  send(input: CombatInput): this {
    const before = this.output.length
    super.send(input)
    for (const tick of this.output.slice(before)) this.splits.push(...this.attributor.handleTick(tick))
    if (input.type === 'effect') this.splits.push(...this.attributor.handleEffect(input))
    return this
  }

  /** Divination of the astrologian, 6%, on the combatant */
  divination(holder: number): this {
    return this.effect(ASTROLOGIAN, 16552, [{ target: holder, raw: [apply(DIVINATION, 6, 0)] }]).gain(
      holder,
      DIVINATION,
      ASTROLOGIAN,
    )
  }

  lastSplit(): DamageAttributionEvent {
    const split = this.splits.at(-1)
    if (!split) throw new Error('no split')
    return split
  }
}

describe('DamageAttributor', () => {
  it('splits a hit by the statuses when it hit', () => {
    const harness = new AttributionHarness().divination(SAMURAI)
    harness.effect(SAMURAI, HAKAZE, [{ target: ENEMY, entities: [damage(10000)] }])
    const split = harness.lastSplit()
    expect(split).toMatchObject({
      attacker: SAMURAI,
      actor: SAMURAI,
      target: ENEMY,
      origin: { type: 'action', action: HAKAZE, sequence: 1 },
      amount: 10000,
    })
    expect(split.contributions).toEqual([
      { statusId: DIVINATION, sourceId: ASTROLOGIAN, amount: expect.closeTo(10000 * DIVINATION_SHARE, 9) },
    ])
    expect(split.retained).toBeCloseTo(10000 / 1.06, 9)
  })

  it('gives no part of a limit break to the raid buffs', () => {
    const harness = new AttributionHarness({ ...testDefs(), limitBreaks: new Set([BRAVER]) }).divination(SAMURAI)
    harness.effect(SAMURAI, BRAVER, [{ target: ENEMY, entities: [damage(10000)] }])
    expect(harness.splits).toEqual([])
    harness.effect(SAMURAI, HAKAZE, [{ target: ENEMY, entities: [damage(10000)] }])
    expect(harness.lastSplit()).toMatchObject({ origin: { type: 'action', action: HAKAZE } })
  })

  it('splits a hit of the player with the rates of the attributes', () => {
    const harness = new AttributionHarness()
    harness.estimator.setPlayerStats(SAMURAI, 3264, 2119)
    harness.gain(SAMURAI, BATTLE_LITANY, ASTROLOGIAN)
    harness.effect(SAMURAI, HAKAZE, [{ target: ENEMY, entities: [damage(10000, AbilityEffectSeverity.Critical)] }])
    const expected = attribute({
      amount: 10000,
      effects: [{ statusId: BATTLE_LITANY, sourceId: ASTROLOGIAN, owner: 'player', type: 'critical', value: 0.1 }],
      rates: { critical: 0.254, direct: 0.336, criticalMultiplier: criticalMultiplierOf(0.254) },
      outcome: { type: 'hit', critical: true, direct: false, forcedCritical: false, forcedDirect: false },
    })
    const split = harness.lastSplit()
    expect(split.contributions).toEqual(expected.contributions)
    expect(split.retained).toBe(expected.retained)
  })

  it('counts a pet for its owner with the statuses of the pet', () => {
    const harness = new AttributionHarness().divination(PET)
    harness.gain(PET, FUGETSU, SAMURAI)
    harness.effect(PET, 16504, [{ target: ENEMY, entities: [damage(10000)] }])
    const split = harness.lastSplit()
    expect(split).toMatchObject({ attacker: SAMURAI, actor: PET })
    // Fugetsu came from the owner, and stays with the owner
    expect(split.contributions.map((item) => [item.sourceId, item.statusId])).toEqual([[ASTROLOGIAN, DIVINATION]])
    expect(split.contributions[0].amount + split.retained).toBeCloseTo(10000, 9)
    expect(split.contributions[0].amount).toBeCloseTo(10000 * DIVINATION_SHARE, 9)
  })

  it('keeps a modifier another player gave that is no raid buff with the attacker', () => {
    const harness = new AttributionHarness().divination(SAMURAI)
    harness.gain(SAMURAI, FUGETSU, ASTROLOGIAN)
    harness.effect(SAMURAI, HAKAZE, [{ target: ENEMY, entities: [damage(10000)] }])
    const split = harness.lastSplit()
    expect(split.contributions.map((item) => [item.sourceId, item.statusId])).toEqual([[ASTROLOGIAN, DIVINATION]])
    expect(split.contributions[0].amount + split.retained).toBeCloseTo(10000, 9)
    expect(split.contributions[0].amount).toBeCloseTo(10000 * DIVINATION_SHARE, 9)
  })

  it('leaves a modifier of a source that is not a player with the attacker when no player gave anything', () => {
    const harness = new AttributionHarness()
    harness.gain(SAMURAI, DIVINATION, ENEMY)
    harness.effect(SAMURAI, HAKAZE, [{ target: ENEMY, entities: [damage(10000)] }])
    const split = harness.lastSplit()
    expect(split.contributions).toEqual([])
    expect(split.retained).toBe(10000)
    expect(split).not.toHaveProperty('unattributed')
  })

  it('counts the statuses other players put on the owner for a pet', () => {
    const harness = new AttributionHarness().divination(SAMURAI)
    harness.effect(PET, 16504, [{ target: ENEMY, entities: [damage(10000)] }])
    const split = harness.lastSplit()
    expect(split).toMatchObject({ attacker: SAMURAI, actor: PET })
    expect(split.contributions).toEqual([
      { statusId: DIVINATION, sourceId: ASTROLOGIAN, amount: expect.closeTo(10000 * DIVINATION_SHARE, 9) },
    ])
  })

  it('counts a status on both the pet and the owner once', () => {
    const harness = new AttributionHarness().divination(SAMURAI).divination(PET)
    harness.effect(PET, 16504, [{ target: ENEMY, entities: [damage(10000)] }])
    const split = harness.lastSplit()
    expect(split.contributions).toEqual([
      { statusId: DIVINATION, sourceId: ASTROLOGIAN, amount: expect.closeTo(10000 * DIVINATION_SHARE, 9) },
    ])
  })

  it('leaves out the damage that is not of a player on an enemy', () => {
    const harness = new AttributionHarness()
    harness
      .effect(SAMURAI, HAKAZE, [
        { target: ASTROLOGIAN, entities: [damage(1000)] },
        { target: PET, entities: [damage(1000)] },
        { target: ENEMY, entities: [{ ...damage(1000), flags: AbilityEffectResultFlag.EffectOnSource }] },
      ])
      .effect(ENEMY, 7, [{ target: ENEMY_2, entities: [damage(1000)] }])
    expect(harness.splits).toEqual([])
  })

  it('splits the shares of a summed tick by their snapshots', () => {
    const harness = applyExample(example(new AttributionHarness())) as AttributionHarness
    const before = harness.splits.length
    harness
      .later(1000)
      .tick(ENEMY, 7000)
      .later(20)
      .list(ENEMY, [
        [COMBUST.status, ASTROLOGIAN],
        [HIGANBANA.status, SAMURAI],
      ])
    const [combust, higanbana] = harness.splits.slice(before)
    const tickId = harness.last().tickId
    expect(combust).toMatchObject({
      attacker: ASTROLOGIAN,
      origin: { type: 'tick', tickId, statusId: COMBUST.status },
      amount: 3983,
    })
    // Divination is the astrologian's own; Battle Litany came from the samurai
    expect(combust.contributions.map((item) => [item.sourceId, item.statusId])).toEqual([[SAMURAI, BATTLE_LITANY]])
    expect(higanbana).toMatchObject({ attacker: SAMURAI, amount: 3017, contributions: [], retained: 3017 })
  })

  it('splits a tick of its own status by the statuses of its application', () => {
    const harness = new AttributionHarness().divination(SAMURAI)
    harness
      .effect(SAMURAI, SALTED_EARTH.action, [{ target: SAMURAI, raw: [apply(SALTED_EARTH.status, 0, 0, false)] }])
      .later(3000)
      .tick(ENEMY, 1000, false, SALTED_EARTH.status, SAMURAI)
    expect(harness.lastSplit()).toMatchObject({
      attacker: SAMURAI,
      origin: { type: 'tick', statusId: SALTED_EARTH.status },
      contributions: [
        { statusId: DIVINATION, sourceId: ASTROLOGIAN, amount: expect.closeTo(1000 * DIVINATION_SHARE, 9) },
      ],
    })
    harness.tick(SAMURAI, 1000, true, 2604, SAGE)
    expect(harness.lastSplit().amount).toBe(1000)
  })

  it('numbers the splits on through zone changes', () => {
    const harness = new AttributionHarness().divination(SAMURAI)
    harness.effect(SAMURAI, HAKAZE, [
      { target: ENEMY, entities: [damage(1000)] },
      { target: ENEMY_2, entities: [damage(1000)] },
    ])
    harness.attributor.changeZone()
    harness.effect(SAMURAI, HAKAZE, [{ target: ENEMY, entities: [damage(1000)] }])
    expect(harness.splits.map((split) => split.id)).toEqual([1, 2, 3])
  })

  describe('closeWindow', () => {
    it('sends how the split of a hit changed with the rates of the whole window', () => {
      const harness = new AttributionHarness()
      harness.effect(ASTROLOGIAN, FALL_MALEFIC, [
        { target: ENEMY, entities: [damage(10000, AbilityEffectSeverity.Critical)] },
      ])
      harness.gain(ASTROLOGIAN, BATTLE_LITANY, SAMURAI, 0)
      harness.effect(ASTROLOGIAN, FALL_MALEFIC, [
        { target: ENEMY, entities: [damage(10000, AbilityEffectSeverity.Critical)] },
      ])
      const realtime = harness.lastSplit()
      harness.lose(ASTROLOGIAN, 0)
      // Many hits that are not critical bring the natural rate down: Battle Litany made the critical hit more likely
      harness.rateHits(ASTROLOGIAN, 0, 0, 60)

      const rates = harness.estimator.rates.rates(ASTROLOGIAN)
      const after = attribute({
        amount: 10000,
        effects: [{ statusId: BATTLE_LITANY, sourceId: SAMURAI, owner: 'player', type: 'critical', value: 0.1 }],
        rates: { ...rates, criticalMultiplier: criticalMultiplierOf(rates.critical) },
        outcome: { type: 'hit', critical: true, direct: false, forcedCritical: false, forcedDirect: false },
      })
      const delta = harness.attributor.closeWindow(null, harness.time)
      expect(delta).toMatchObject({ eventType: 'AttributionDeltaEvent', eventTime: harness.time })
      // The hits without Battle Litany gave nothing, before or after
      expect(delta?.records).toHaveLength(1)
      const [record] = delta?.records ?? []
      expect(record).toMatchObject({
        id: realtime.id,
        tickId: null,
        attacker: ASTROLOGIAN,
        actor: ASTROLOGIAN,
        origin: { type: 'action', action: FALL_MALEFIC },
      })
      expect(record.contributions).toEqual([{ statusId: BATTLE_LITANY, sourceId: SAMURAI, amount: expect.any(Number) }])
      expect(record.contributions[0].amount).toBeGreaterThan(0)
      expect(realtime.contributions[0].amount + record.contributions[0].amount).toBeCloseTo(
        after.contributions[0].amount,
        9,
      )
      // A new window starts
      expect(harness.attributor.closeWindow(null, harness.time)).toBeNull()
    })

    it('takes a share the revision gave to another source away from the realtime one', () => {
      const harness = applyExample(example(new AttributionHarness())) as AttributionHarness
      harness.later(1000).tick(ENEMY, 7000).later(20).list(ENEMY, [])
      const tick = harness.last()
      const before = harness.splits.length
      const combust = harness.splits.find(
        (split) =>
          split.origin.type === 'tick' && split.origin.tickId === tick.tickId && split.attacker === ASTROLOGIAN,
      )
      expect(combust?.contributions).toEqual([
        { statusId: BATTLE_LITANY, sourceId: SAMURAI, amount: expect.any(Number) },
      ])

      // The revision gives the share of Combust to the sage, under the same snapshot
      const revision: PeriodicRevisionEvent = {
        eventType: 'PeriodicRevisionEvent',
        eventTime: harness.time,
        ticks: [
          {
            ...tick,
            phase: 'post',
            shares: tick.shares.map((share) => (share.sourceId === ASTROLOGIAN ? { ...share, sourceId: SAGE } : share)),
          },
        ],
      }
      const delta = harness.attributor.closeWindow(revision, harness.time)
      expect(harness.splits.length).toBe(before)
      const shares = delta?.records.filter((record) => record.tickId === tick.tickId)
      expect(shares).toHaveLength(2)
      const [astrologian, sage] = [ASTROLOGIAN, SAGE].map((actor) => shares?.find((record) => record.actor === actor))
      expect(astrologian).toMatchObject({
        id: null,
        attacker: ASTROLOGIAN,
        origin: { type: 'tick', statusId: COMBUST.status },
        contributions: [
          { statusId: BATTLE_LITANY, sourceId: SAMURAI, amount: -(combust?.contributions[0].amount ?? 0) },
        ],
      })
      // Divination was the astrologian's own; for the sage it is the astrologian's modifier
      expect(sage).toMatchObject({ id: null, attacker: SAGE, origin: { type: 'tick', statusId: COMBUST.status } })
      expect(sage?.contributions.map((item) => [item.sourceId, item.statusId])).toEqual(
        [
          [SAMURAI, BATTLE_LITANY],
          [ASTROLOGIAN, DIVINATION],
        ].sort((a, b) => a[0] - b[0] || a[1] - b[1]),
      )
      expect(sage?.contributions.every((item) => item.amount > 0)).toBe(true)
    })

    it('sends nothing for a window without modifiers of others', () => {
      const harness = new AttributionHarness()
      harness.effect(SAMURAI, HAKAZE, [{ target: ENEMY, entities: [damage(1000, AbilityEffectSeverity.Critical)] }])
      harness.rateHits(SAMURAI, 0, 0, 30)
      expect(harness.splits.length).toBeGreaterThan(0)
      expect(harness.attributor.closeWindow(null, harness.time)).toBeNull()
    })

    it('forgets the window when the zone changes', () => {
      const harness = new AttributionHarness()
      harness.gain(ASTROLOGIAN, BATTLE_LITANY, SAMURAI, 0)
      harness.effect(ASTROLOGIAN, FALL_MALEFIC, [
        { target: ENEMY, entities: [damage(10000, AbilityEffectSeverity.Critical)] },
      ])
      harness.rateHits(ASTROLOGIAN, 0, 0, 60)
      harness.attributor.changeZone()
      expect(harness.attributor.closeWindow(null, harness.time)).toBeNull()
    })
  })
})
