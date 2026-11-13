import { describe, expect, it } from 'vitest'
import { conditionWindow, EORZEA_HOUR_MS as HOUR, isNight, weatherAt, weatherChance } from './weather.js'

// Expected values evaluated from the pinned upstream resources/weather.ts.
const chanceCases = [
  [0, 56],
  [1_399_999, 56],
  [1_400_000, 12],
  [1_699_999_200_000, 53],
  [1_700_000_000_000, 53],
  [1_700_000_600_000, 2],
  [1_700_002_000_000, 42],
] as const
const anemos = [
  { weatherId: 2, rate: 30 },
  { weatherId: 6, rate: 30 },
  { weatherId: 8, rate: 30 },
  { weatherId: 15, rate: 10 },
]

describe('Eureka weather and night conditions', () => {
  it.each(chanceCases)('matches upstream chance at %i', (time, expected) => {
    expect(weatherChance(time)).toBe(expected)
  })
  it('uses client percentage weights and rejects missing distributions', () => {
    expect(weatherAt(0, anemos)).toBe(6)
    expect(weatherAt(1_400_000, anemos)).toBe(2)
    expect(weatherAt(0, null)).toBeNull()
    expect(weatherAt(0, [{ weatherId: 6, rate: 50 }])).toBeNull()
    expect(weatherAt(Number.NaN, anemos)).toBeNull()
  })
  it('includes 19:00 and excludes 06:00', () => {
    expect(isNight(19 * HOUR - 1)).toBe(false)
    expect(isNight(19 * HOUR)).toBe(true)
    expect(isNight(6 * HOUR - 1)).toBe(true)
    expect(isNight(6 * HOUR)).toBe(false)
    expect(conditionWindow(6 * HOUR, null, true, null)).toEqual({ opensAt: 19 * HOUR, closesAt: 30 * HOUR })
    expect(conditionWindow(20 * HOUR, null, true, null)).toEqual({ opensAt: 20 * HOUR, closesAt: 30 * HOUR })
  })
  it('intersects weather with night across weather boundaries', () => {
    expect(conditionWindow(0, 6, true, anemos)).toEqual({ opensAt: 0, closesAt: 6 * HOUR })
    const next = conditionWindow(6 * HOUR, 6, true, anemos)
    expect(next).not.toBeNull()
    if (!next || next.closesAt === null) throw new Error('Expected a finite condition window')
    expect(next.opensAt).toBeGreaterThan(6 * HOUR)
    expect(isNight(next.opensAt)).toBe(true)
    expect(weatherAt(next.opensAt, anemos)).toBe(6)
    expect(isNight(next.closesAt) && weatherAt(next.closesAt, anemos) === 6).toBe(false)
  })
  it('preserves unknown conditions and unlimited unconstrained windows', () => {
    expect(conditionWindow(0, 6, false, null)).toBeNull()
    expect(conditionWindow(0, 9, false, anemos)).toBeNull()
    expect(conditionWindow(123, null, false, null)).toEqual({ opensAt: 123, closesAt: null })
    expect(conditionWindow(123, 6, false, [{ weatherId: 6, rate: 100 }])).toEqual({ opensAt: 123, closesAt: null })
  })
})
