import { describe, expect, it } from 'vitest'
import type { SampleAction } from '../defs.js'
import { samplePotency } from './samples.js'

/** Storm's Path of the warrior */
const STORMS_PATH: SampleAction = {
  job: 21,
  potency: { base: [{ level: 1, potency: 190 }], combo: [{ level: 1, potency: 340 }] },
}

/** Gekko of the samurai, whose combo potency rises at level 84 */
const GEKKO: SampleAction = {
  job: 34,
  potency: {
    base: [{ level: 1, potency: 160 }],
    rear: [{ level: 1, potency: 210 }],
    combo: [
      { level: 1, potency: 320 },
      { level: 84, potency: 370 },
    ],
    comboRear: [
      { level: 1, potency: 370 },
      { level: 84, potency: 420 },
    ],
  },
}

describe('samplePotency', () => {
  it('takes the base potency without a bonus', () => {
    expect(samplePotency(STORMS_PATH, 100, 100, 0)).toBe(190)
  })

  it('takes the potency whose bonus is that of the hit', () => {
    expect(samplePotency(STORMS_PATH, 100, 100, 44)).toBe(340)
    expect(samplePotency(GEKKO, 100, 100, 56)).toBe(370)
    expect(samplePotency(GEKKO, 100, 100, 61)).toBe(420)
    expect(samplePotency(GEKKO, 100, 100, 23)).toBe(210)
  })

  it('reads the potencies at the level of the caster', () => {
    // At level 80, 320 in a combo and 370 in a combo from the rear
    expect(samplePotency(GEKKO, 80, 100, 50)).toBe(320)
    expect(samplePotency(GEKKO, 80, 100, 56)).toBe(370)
    expect(samplePotency(GEKKO, 80, 100, 61)).toBeNull()
  })

  it('has no potency for a bonus no potency gives', () => {
    expect(samplePotency(STORMS_PATH, 100, 100, 43)).toBeNull()
    expect(samplePotency(STORMS_PATH, 100, 100, 10)).toBeNull()
  })

  it('has no potency at level 0 or above maxLevel', () => {
    expect(samplePotency(STORMS_PATH, 0, 100, 0)).toBeNull()
    expect(samplePotency(STORMS_PATH, 101, 100, 44)).toBeNull()
  })

  it('has no potency when two potencies give the same bonus', () => {
    const action: SampleAction = {
      job: 34,
      potency: {
        base: [{ level: 1, potency: 100 }],
        rear: [{ level: 1, potency: 200 }],
        flank: [{ level: 1, potency: 200 }],
      },
    }
    expect(samplePotency(action, 100, 100, 50)).toBeNull()
  })
})
