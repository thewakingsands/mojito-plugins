import { describe, expect, it } from 'vitest'
import { type AttributionEffect, type AttributionInput, type AttributionOutcome, attribute } from './kernel.js'

const ASTROLOGIAN = 0x10000001
const DRAGOON = 0x10000002
const DANCER = 0x10000003
const ATTACKER = 0x10000004
const ENEMY = 0x40000001

const DIVINATION: AttributionEffect = {
  statusId: 1878,
  sourceId: ASTROLOGIAN,
  owner: 'player',
  type: 'multiplier',
  value: 1.06,
}
const OWN: AttributionEffect = { statusId: 1298, sourceId: ATTACKER, owner: 'self', type: 'multiplier', value: 1.1 }
const LITANY: AttributionEffect = { statusId: 786, sourceId: DRAGOON, owner: 'player', type: 'critical', value: 0.1 }
const TANGO: AttributionEffect = { statusId: 1825, sourceId: DANCER, owner: 'player', type: 'direct', value: 0.2 }

const rates = { critical: 0.2, direct: 0.15, criticalMultiplier: 1.55 }
const hit = (fields: Partial<Extract<AttributionOutcome, { type: 'hit' }>> = {}): AttributionOutcome => ({
  type: 'hit',
  critical: false,
  direct: false,
  forcedCritical: false,
  forcedDirect: false,
  ...fields,
})
const input = (effects: AttributionEffect[], outcome: AttributionOutcome, amount = 10000): AttributionInput => ({
  amount,
  effects,
  rates,
  outcome,
})

/** The amount of each source, and what stays with the attacker */
function parts(input: AttributionInput) {
  const result = attribute(input)
  const bySource: Record<number, number> = {}
  for (const item of result.contributions) bySource[item.sourceId] = (bySource[item.sourceId] ?? 0) + item.amount
  return { ...bySource, retained: result.retained }
}

/** Every amount within 0.01 of the one expected */
function expectAmounts(actual: Record<string, number>, expected: Record<string, number>) {
  expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort())
  for (const [key, value] of Object.entries(expected)) expect(Math.abs(actual[key] - value)).toBeLessThanOrEqual(0.01)
}

describe('attribute', () => {
  // OWN is a condition of the damage: it is in the amount, and the raid buffs get no less for it
  it.each([
    ['a hit that is not critical', [DIVINATION, OWN, LITANY], hit(), { [ASTROLOGIAN]: 566.04, retained: 9433.96 }],
    [
      'a critical hit',
      [DIVINATION, OWN, LITANY],
      hit({ critical: true }),
      { [ASTROLOGIAN]: 530.45, [DRAGOON]: 1151.43, retained: 8318.12 },
    ],
    [
      'a critical direct hit with Tango',
      [DIVINATION, OWN, LITANY, TANGO],
      hit({ critical: true, direct: true }),
      { [ASTROLOGIAN]: 499.94, [DRAGOON]: 1088.62, [DANCER]: 1043.96, retained: 7367.48 },
    ],
    [
      'a forced critical direct hit with Tango',
      [DIVINATION, OWN, LITANY, TANGO],
      hit({ forcedCritical: true, forcedDirect: true }),
      { [ASTROLOGIAN]: 538.31, [DRAGOON]: 494.63, [DANCER]: 450.74, retained: 8516.33 },
    ],
    [
      'a tick',
      [DIVINATION, OWN, LITANY],
      { type: 'expected' } as const,
      { [ASTROLOGIAN]: 552.7, [DRAGOON]: 458.72, retained: 8988.58 },
    ],
  ])('splits %s with a modifier of the attacker beside the raid buffs', (_, effects, outcome, expected) => {
    expectAmounts(parts(input(effects, outcome)), expected)
  })

  it('leaves everything with the attacker for its own modifiers', () => {
    const own = [OWN, { ...LITANY, sourceId: ATTACKER, owner: 'self' as const }]
    for (const outcome of [hit({ critical: true }), hit({ forcedCritical: true }), { type: 'expected' as const }]) {
      expect(attribute(input(own, outcome))).toEqual({ retained: 10000, contributions: [] })
    }
  })

  it('leaves the part of a source that is not a player with the attacker when no player gave anything', () => {
    const result = attribute(input([{ ...DIVINATION, sourceId: ENEMY, owner: 'other' }], hit()))
    expect(result).toEqual({ retained: 10000, contributions: [] })
  })

  it.each([
    ['alone', []],
    ['beside a multiplier of the attacker', [OWN]],
    ['beside a multiplier of a source that is not a player', [{ ...OWN, sourceId: ENEMY, owner: 'other' as const }]],
  ])('gives a multiplier of another player what the damage loses without it %s', (_, others) => {
    const result = attribute(input([...others, { ...DIVINATION, value: 1.05 }], hit()))
    expect(result.contributions.map((item) => [item.sourceId, item.amount])).toEqual([
      [ASTROLOGIAN, expect.closeTo(10000 * (1 - 1 / 1.05), 9)],
    ])
    expect(result.retained).toBeCloseTo(10000 / 1.05, 9)
  })

  it.each([
    ['a natural rate', 0.45, []],
    [
      'a rate of the attacker',
      0.25,
      [{ ...LITANY, statusId: 1825, sourceId: ATTACKER, owner: 'self' as const, value: 0.2 }],
    ],
  ])(
    'gives a critical rate of another player on a tick what the tick loses without it, beside %s',
    (_, natural, own) => {
      const result = attribute({
        amount: 10000,
        effects: [...own, LITANY],
        rates: { critical: natural, direct: 0.3, criticalMultiplier: 1.6 },
        outcome: { type: 'expected' },
      })
      // The critical rate is 0.45 without Battle Litany and 0.55 with it; K − 1 is 0.6
      expect(result.contributions.map((item) => [item.sourceId, item.amount])).toEqual([
        [DRAGOON, expect.closeTo(10000 * (1 - 1.27 / 1.33), 9)],
      ])
    },
  )

  it.each([
    ['a critical hit', hit({ critical: true })],
    ['a forced critical hit', hit({ forcedCritical: true })],
    ['a tick', { type: 'expected' } as const],
  ])('takes a critical rate of a source that is not a player as one of the attacker for %s', (_, outcome) => {
    const enemy: AttributionEffect = { ...LITANY, sourceId: ENEMY, owner: 'other' }
    expect(attribute(input([enemy, LITANY], outcome))).toEqual(
      attribute(input([{ ...enemy, owner: 'self' }, LITANY], outcome)),
    )
  })

  it.each([
    ['a critical hit', hit({ critical: true })],
    ['a forced critical hit', hit({ forcedCritical: true })],
    ['a tick', { type: 'expected' } as const],
  ])(
    'keeps the parts whole when a source that is not a player takes more critical rate than there is for %s',
    (_, outcome) => {
      const down: AttributionEffect = { ...LITANY, sourceId: ENEMY, owner: 'other', value: -0.3 }
      const result = attribute(input([down, { ...LITANY, value: 0.2 }], outcome))
      const total = result.retained + result.contributions.reduce((a, b) => a + b.amount, 0)
      expect(Math.abs(total - 10000)).toBeLessThanOrEqual(1e-9)
      expect(result.retained).toBeGreaterThanOrEqual(0)
      for (const item of result.contributions) expect(item.amount).toBeGreaterThanOrEqual(0)
    },
  )

  it('leaves a damage down of a source that is not a player out of the split', () => {
    const down: AttributionEffect = { ...DIVINATION, sourceId: ENEMY, owner: 'other', value: 0.8 }
    expectAmounts(parts(input([down, DIVINATION], hit())), parts(input([DIVINATION], hit())))
    const result = attribute(input([down, DIVINATION], hit()))
    expect(result.retained + result.contributions.reduce((a, b) => a + b.amount, 0)).toBeCloseTo(10000, 9)
    expect(result.retained).toBeGreaterThanOrEqual(0)
    for (const item of result.contributions) expect(item.amount).toBeGreaterThanOrEqual(0)
  })

  it('leaves a multiplier of 1 or less out of the split', () => {
    const weakness = { ...DIVINATION, value: 0.75 }
    expect(attribute(input([weakness], hit()))).toEqual({ retained: 10000, contributions: [] })
    expectAmounts(parts(input([weakness, DIVINATION], hit())), parts(input([DIVINATION], hit())))
  })

  it('gives the rate modifiers nothing when the hit was neither critical nor direct', () => {
    expect(attribute(input([LITANY, TANGO], hit())).contributions).toEqual([])
  })

  it('takes the forced results with the modifiers of the attacker as its own', () => {
    const own = { ...LITANY, statusId: 1825, sourceId: ATTACKER, owner: 'self' as const, value: 0.2 }
    const result = parts(input([own, LITANY], hit({ forcedCritical: true })))
    // K − 1 is 0.55: the damage is 1 + 0.55 × 0.3 of its base with Battle Litany, and 1 + 0.55 × 0.2 without it
    const given = 10000 * (1 - 1.11 / 1.165)
    expectAmounts(result, { [DRAGOON]: given, retained: 10000 - given })
  })

  it('shares the rate left under the cap as the modifiers would share what they add', () => {
    const second = { ...LITANY, statusId: 3685, sourceId: ASTROLOGIAN, value: 0.3 }
    const result = attribute({
      amount: 10000,
      effects: [LITANY, second],
      rates: { critical: 0.9, direct: 0, criticalMultiplier: 2.25 },
      outcome: hit({ critical: true }),
    })
    // The others made the critical hit with the chance 0.1 / 1, and K gives a bonus of 10000 × (1 − 1 / 2.25)
    const bonus = 0.1 * 10000 * (1 - 1 / 2.25)
    expect(result.contributions.map((item) => [item.sourceId, item.amount])).toEqual([
      [ASTROLOGIAN, expect.closeTo(bonus * 0.75, 9)],
      [DRAGOON, expect.closeTo(bonus * 0.25, 9)],
    ])
  })

  it('makes one contribution of a status and a source, sorted by source and status', () => {
    const result = attribute(
      input([{ ...DIVINATION, statusId: 3889 }, DIVINATION, { ...DIVINATION, value: 1.02 }, LITANY], hit()),
    )
    expect(result.contributions.map((item) => [item.sourceId, item.statusId])).toEqual([
      [ASTROLOGIAN, 1878],
      [ASTROLOGIAN, 3889],
    ])
  })

  /** A linear congruential generator, for inputs that are the same on every run */
  const generator = (seed: number) => () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31
    return seed / 2 ** 31
  }
  const types = ['multiplier', 'critical', 'direct'] as const
  const randomEffects = (random: () => number, owners: readonly AttributionEffect['owner'][]) =>
    Array.from({ length: Math.floor(random() * 8) }, (_, index): AttributionEffect => {
      const type = types[Math.floor(random() * 3)]
      return {
        statusId: 100 + Math.floor(random() * 4),
        sourceId: 0x10000000 + index,
        owner: owners[Math.floor(random() * owners.length)],
        type,
        value: type === 'multiplier' ? 0.7 + random() * 0.6 : random() * 0.5,
      }
    })
  const randomOutcome = (random: () => number): AttributionOutcome =>
    random() < 0.2
      ? { type: 'expected' }
      : hit({
          critical: random() < 0.4,
          direct: random() < 0.4,
          forcedCritical: random() < 0.1,
          forcedDirect: random() < 0.1,
        })
  const randomRates = (random: () => number) => {
    const critical = random() * 0.6
    return { critical, direct: random() * 0.6, criticalMultiplier: 1.35 + critical }
  }

  it('keeps the parts adding up to the amount', () => {
    const random = generator(20261023)
    for (let run = 0; run < 1000; run++) {
      const effects = randomEffects(random, ['self', 'player', 'other'])
      const outcome = randomOutcome(random)
      const rates = randomRates(random)
      const amount = 1 + random() * 100000
      const result = attribute({ amount, effects, rates, outcome })
      const total = result.retained + result.contributions.reduce((a, b) => a + b.amount, 0)
      expect(Math.abs(total - amount)).toBeLessThanOrEqual(amount * 1e-9)
      expect(result.retained).toBeGreaterThanOrEqual(0)
      for (const item of result.contributions) expect(item.amount).toBeGreaterThanOrEqual(0)
    }
  })

  it('gives a lone multiplier of another player what the damage loses without it, whatever the attacker has', () => {
    const random = generator(20261109)
    for (let run = 0; run < 1000; run++) {
      // No rates of other players: on a critical or direct hit and on a tick they would share with the multiplier
      const effects = randomEffects(random, ['self', 'other'])
      const buff: AttributionEffect = { ...DIVINATION, value: 1.01 + random() * 0.29 }
      const outcome = randomOutcome(random)
      const rates = randomRates(random)
      const amount = 1 + random() * 100000
      const result = attribute({ amount, effects: [...effects, buff], rates, outcome })
      expect(result.contributions).toHaveLength(1)
      expect(Math.abs(result.contributions[0].amount - amount * (1 - 1 / buff.value))).toBeLessThanOrEqual(
        amount * 1e-9,
      )
    }
  })
})
