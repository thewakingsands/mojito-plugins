import { describe, expect, it } from 'vitest'
import { estimateRate, PRIOR_RATE, type RateSample, RateSamples } from './rates.js'

const samples = (hits: number, total: number, delta = 0): RateSample[] =>
  Array.from({ length: total }, (_, index) => ({ hit: index < hits, delta }))

describe('estimateRate', () => {
  it.each([
    [5, 20],
    [6, 20],
    [2, 20],
    [4, 20],
    [0, 10],
    [30, 100],
  ])('is (k + 1) / (n + 8) for %i of %i without modifiers', (hits, total) => {
    expect(Math.abs(estimateRate(samples(hits, total)) - (hits + 1) / (total + 8))).toBeLessThan(1e-5)
  })

  it('leaves out the rate the modifiers added', () => {
    // with 10% added, 15 hits of 50 tell about the same natural rate as 10 of 50 without
    const withDelta = estimateRate(samples(15, 50, 0.1))
    const without = estimateRate(samples(10, 50))
    expect(withDelta).toBeLessThan(without + 0.02)
    expect(withDelta).toBeGreaterThan(without - 0.02)
    expect(withDelta).toBeLessThan(estimateRate(samples(15, 50)))
  })

  it('is the mode of the prior without samples', () => {
    expect(estimateRate([])).toBe(0.125)
    expect(new RateSamples().rates(1)).toEqual({ critical: PRIOR_RATE, direct: PRIOR_RATE })
  })
})

describe('RateSamples', () => {
  it('estimates the critical and direct rates of each caster apart', () => {
    const rates = new RateSamples()
    for (const { hit } of samples(5, 20)) rates.addCritical(1, hit, 0)
    for (const { hit } of samples(2, 20)) rates.addDirect(1, hit, 0)
    expect(rates.rates(1).critical).toBeCloseTo(6 / 28, 5)
    expect(rates.rates(1).direct).toBeCloseTo(3 / 28, 5)
    expect(rates.rates(2).critical).toBe(PRIOR_RATE)
    rates.addCritical(1, true, 0)
    expect(rates.rates(1).critical).toBeCloseTo(7 / 29, 5)
  })
})
