import { describe, expect, it } from 'vitest'
import { computePrior, damageCandidates, type PriorInput } from './prior.js'

/** The example of design.md: Combust III under Divination and Battle Litany */
const combust: PriorInput = {
  kind: 'damage',
  base: 40 * 70 * 1.06,
  lowByte: 174,
  critByte: 58,
  critical: 6 / 28,
  direct: 3 / 28,
  critDelta: 0.1,
  directDelta: 0,
}

/** Higanbana without buffs */
const higanbana: PriorInput = {
  kind: 'damage',
  base: 46 * 50,
  lowByte: 6,
  critByte: 250,
  critical: 7 / 28,
  direct: 5 / 28,
  critDelta: 0,
  directDelta: 0,
}

const relative = (actual: number, expected: number) => Math.abs(actual - expected) / Math.abs(expected)

describe('damageCandidates', () => {
  it('weighs the low bytes of the example', () => {
    const candidates = damageCandidates(combust)
    // 0.058 is below Δc, so the rates are 0.314, 0.570 and 0.826
    expect([...new Set(candidates.map((item) => item.rate))]).toEqual([0.314, 0.57, 0.826])
    const best = candidates.reduce((a, b) => (a.weight > b.weight ? a : b))
    expect(best.base).toBe(2990)
    expect(best.rate).toBe(0.314)
    const weightOf = (base: number) =>
      candidates.filter((item) => item.base === base).reduce((sum, item) => sum + item.weight, 0)
    expect(weightOf(2990)).toBeCloseTo(0.284, 3)
    const ranked = [...new Set(candidates.map((item) => item.base))].sort((a, b) => weightOf(b) - weightOf(a))
    expect(ranked.slice(0, 3)).toEqual([2990, 2734, 3246])

    // 0.506 and 0.762 are candidates of Higanbana too, with weights that do not count
    const other = damageCandidates(higanbana)
    const rateWeight = (rate: number) =>
      other.filter((item) => item.rate === rate).reduce((sum, item) => sum + item.weight, 0)
    expect(rateWeight(0.25)).toBeGreaterThan(0.999)
    expect(rateWeight(0.25) + rateWeight(0.506) + rateWeight(0.762)).toBeCloseTo(1, 12)
    expect(other.filter((item) => item.base === 2310 && item.rate === 0.25)[0].weight).toBeCloseTo(0.368, 3)
  })

  it('takes q and the estimated rate without the bytes', () => {
    expect(damageCandidates({ ...combust, lowByte: null, critByte: null })).toEqual([
      { base: combust.base, rate: 6 / 28 + 0.1, weight: 1 },
    ])
  })

  it('takes the estimated rate when no candidate of the byte fits', () => {
    // every candidate of byte 2 is below Δc
    const candidates = damageCandidates({ ...combust, critByte: 10, critDelta: 0.95 })
    expect(new Set(candidates.map((item) => item.rate))).toEqual(new Set([Math.min(0.999, 6 / 28 + 0.95)]))
  })
})

describe('computePrior', () => {
  it('gives the moments of the example', () => {
    const first = computePrior(combust)
    expect(relative(first.mean, 3613.45)).toBeLessThan(1e-6)
    expect(relative(first.variance, 746112.6)).toBeLessThan(1e-6)
    expect(first.criticalMultiplier).toBeCloseTo(1.35 + 6 / 28, 12)

    const second = computePrior(higanbana)
    expect(relative(second.mean, 2783.09)).toBeLessThan(1e-6)
    expect(relative(second.variance, 477392.6)).toBeLessThan(1e-6)
  })

  it('uses only q and the natural critical rate for a heal', () => {
    const heal = computePrior({ ...combust, kind: 'heal', base: 1000 })
    const K = 1.35 + 6 / 28
    const c = 6 / 28
    expect(heal.mean).toBeCloseTo(1000 * (1 + c * (K - 1)), 9)
    const h1 = 1 + c * (K - 1)
    const h2 = 1 + c * (K * K - 1)
    expect(heal.variance).toBeCloseTo(1000 * 1000 * ((1 + 0.01 / 12) * h2 - h1 * h1), 6)
  })
})
