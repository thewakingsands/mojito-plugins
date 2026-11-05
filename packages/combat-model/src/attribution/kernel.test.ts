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
  // The table of the example of design.md
  it.each([
    ['a hit that is not critical', [DIVINATION, OWN, LITANY], hit(), { [ASTROLOGIAN]: 540.15, retained: 9459.85 }],
    [
      'a critical hit',
      [DIVINATION, OWN, LITANY],
      hit({ critical: true }),
      { [ASTROLOGIAN]: 506.7, [DRAGOON]: 1102.58, retained: 8390.72 },
    ],
    [
      'a critical direct hit with Tango',
      [DIVINATION, OWN, LITANY, TANGO],
      hit({ critical: true, direct: true }),
      { [ASTROLOGIAN]: 478.01, [DRAGOON]: 1043.42, [DANCER]: 998.97, retained: 7479.59 },
    ],
    [
      'a forced critical direct hit with Tango',
      [DIVINATION, OWN, LITANY, TANGO],
      hit({ forcedCritical: true, forcedDirect: true }),
      { [ASTROLOGIAN]: 514.1, [DRAGOON]: 472.39, [DANCER]: 430.47, retained: 8583.03 },
    ],
    [
      'a tick',
      [DIVINATION, OWN, LITANY],
      { type: 'expected' } as const,
      { [ASTROLOGIAN]: 527.62, [DRAGOON]: 437.91, retained: 9034.47 },
    ],
  ])('splits %s as the example', (_, effects, outcome, expected) => {
    expectAmounts(parts(input(effects, outcome)), expected)
  })

  it('leaves everything with the attacker for its own modifiers', () => {
    const own = [OWN, { ...LITANY, sourceId: ATTACKER, owner: 'self' as const }]
    for (const outcome of [hit({ critical: true }), hit({ forcedCritical: true }), { type: 'expected' as const }]) {
      expect(attribute(input(own, outcome))).toEqual({ retained: 10000, contributions: [], unattributed: 0 })
    }
  })

  it('gives the part of a source that is not a player to nobody', () => {
    const result = attribute(input([{ ...DIVINATION, sourceId: ENEMY, owner: 'other' }], hit()))
    expect(result.contributions).toEqual([])
    expect(result.unattributed).toBeCloseTo(10000 * (1 - 1 / 1.06), 9)
    expect(result.retained).toBeCloseTo(10000 / 1.06, 9)
  })

  it('leaves a multiplier of 1 or less out of the split', () => {
    const weakness = { ...DIVINATION, value: 0.75 }
    expect(attribute(input([weakness], hit()))).toEqual({ retained: 10000, contributions: [], unattributed: 0 })
    expectAmounts(parts(input([weakness, DIVINATION], hit())), parts(input([DIVINATION], hit())))
  })

  it('gives the rate modifiers nothing when the hit was neither critical nor direct', () => {
    expect(attribute(input([LITANY, TANGO], hit())).contributions).toEqual([])
  })

  it('takes the forced results with the modifiers of the attacker as its own', () => {
    const own = { ...LITANY, statusId: 1825, sourceId: ATTACKER, owner: 'self' as const, value: 0.2 }
    const result = parts(input([own, LITANY], hit({ forcedCritical: true })))
    // K − 1 is 0.55: the attacker keeps 1 + 0.55 × 0.2, Battle Litany gives the rest of 1 + 0.55 × 0.3
    const total = 1 + 0.55 * 0.3
    const kept = 1 + 0.55 * 0.2
    const bonus = 10000 * (1 - 1 / total)
    expectAmounts(result, {
      [DRAGOON]: (bonus * Math.log(total / kept)) / Math.log(total),
      retained: 10000 - (bonus * Math.log(total / kept)) / Math.log(total),
    })
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

  it('keeps the parts adding up to the amount', () => {
    // A linear congruential generator, for inputs that are the same on every run
    let seed = 20261023
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31
      return seed / 2 ** 31
    }
    const owners = ['self', 'player', 'other'] as const
    const types = ['multiplier', 'critical', 'direct'] as const
    for (let run = 0; run < 1000; run++) {
      const effects: AttributionEffect[] = Array.from({ length: Math.floor(random() * 8) }, (_, index) => {
        const type = types[Math.floor(random() * 3)]
        return {
          statusId: 100 + Math.floor(random() * 4),
          sourceId: 0x10000000 + index,
          owner: owners[Math.floor(random() * 3)],
          type,
          value: type === 'multiplier' ? 0.7 + random() * 0.6 : random() * 0.5,
        }
      })
      const outcome: AttributionOutcome =
        random() < 0.2
          ? { type: 'expected' }
          : hit({
              critical: random() < 0.4,
              direct: random() < 0.4,
              forcedCritical: random() < 0.1,
              forcedDirect: random() < 0.1,
            })
      const critical = random() * 0.6
      const amount = 1 + random() * 100000
      const result = attribute({
        amount,
        effects,
        rates: { critical, direct: random() * 0.6, criticalMultiplier: 1.35 + critical },
        outcome,
      })
      const total = result.retained + result.unattributed + result.contributions.reduce((a, b) => a + b.amount, 0)
      expect(Math.abs(total - amount)).toBeLessThanOrEqual(amount * 1e-9)
      expect(result.retained).toBeGreaterThanOrEqual(0)
      expect(result.unattributed).toBeGreaterThanOrEqual(0)
      for (const item of result.contributions) expect(item.amount).toBeGreaterThanOrEqual(0)
    }
  })
})
