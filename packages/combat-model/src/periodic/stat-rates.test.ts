import { describe, expect, it } from 'vitest'
import { criticalMultiplierOf } from './prior.js'
import { ratesOfStats } from './stat-rates.js'

const LEVEL_100 = { sub: 420, div: 2780 }
const LEVEL_68 = { sub: 362, div: 840 }

describe('ratesOfStats', () => {
  it.each([
    [LEVEL_100, 420, 420, 0.05, 0],
    [LEVEL_100, 433, 425, 0.05, 0],
    [LEVEL_100, 434, 426, 0.051, 0.001],
    [LEVEL_68, 1063, 806, 0.216, 0.29],
    [LEVEL_100, 3264, 2119, 0.254, 0.336],
  ])('computes the rates with %o at %i and %i', (modifier, criticalHit, directHit, critical, direct) => {
    expect(ratesOfStats({ criticalHit, directHit }, modifier)).toEqual({ critical, direct })
  })

  it.each([
    [419, 500],
    [500, 419],
  ])('has no rates for the attributes %i and %i below the base', (criticalHit, directHit) => {
    expect(ratesOfStats({ criticalHit, directHit }, LEVEL_100)).toBeNull()
  })

  it('gives the critical multiplier of the usual formula', () => {
    const usual = 1.4 + Math.floor((200 * (3264 - 420)) / 2780) / 1000
    expect(criticalMultiplierOf(0.254)).toBeCloseTo(usual, 12)
  })
})
