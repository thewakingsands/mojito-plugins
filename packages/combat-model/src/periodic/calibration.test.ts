import { describe, expect, it } from 'vitest'
import { CALIBRATION_WINDOW, CalibrationSamples, samplePerPotency } from './calibration.js'

const MALEFIC = [
  { level: 1, potency: 250 },
  { level: 94, potency: 270 },
]

describe('samplePerPotency', () => {
  it('divides by the potency at the level of the caster', () => {
    expect(samplePerPotency(10800, MALEFIC, 100, 100, 1, 1)).toBe(40)
    expect(samplePerPotency(10000, MALEFIC, 93, 100, 1, 1)).toBe(40)
  })

  it('divides by the potency modifiers and the multiplier', () => {
    expect(samplePerPotency(10800 * 1.8 * 1.06, MALEFIC, 100, 100, 1.8, 1.06)).toBeCloseTo(40, 9)
  })

  it('has no sample at level 0', () => {
    expect(samplePerPotency(10800, MALEFIC, 0, 100, 1, 1)).toBeNull()
  })
})

describe('CalibrationSamples', () => {
  it('takes the median of the medians of the actions', () => {
    const samples = new CalibrationSamples()
    // The example of design.md: 10800, 11070, 10530 of potency 270
    for (const amount of [10800, 11070, 10530]) samples.add(1, 'damage', 25871, amount / 270)
    expect(samples.perPotency(1, 'damage')).toBe(40)

    // Many samples of one action weigh as much as one of another
    for (const value of [10, 10, 10, 10]) samples.add(2, 'damage', 1, value)
    samples.add(2, 'damage', 2, 20)
    samples.add(2, 'damage', 3, 30)
    expect(samples.perPotency(2, 'damage')).toBe(20)
  })

  it('keeps damage and heal apart', () => {
    const samples = new CalibrationSamples()
    samples.add(1, 'damage', 1, 40)
    samples.add(1, 'heal', 2, 30)
    expect(samples.perPotency(1, 'damage')).toBe(40)
    expect(samples.perPotency(1, 'heal')).toBe(30)
    expect(samples.perPotency(2, 'heal')).toBeNull()
  })

  it('reads the last 300 samples, or all of them', () => {
    const samples = new CalibrationSamples()
    for (let index = 0; index < 100; index++) samples.add(1, 'damage', 1, 10)
    for (let index = 0; index < CALIBRATION_WINDOW; index++) samples.add(1, 'damage', 1, 20)
    expect(samples.perPotency(1, 'damage')).toBe(20)
    for (let index = 0; index < 300; index++) samples.add(1, 'damage', 1, 10)
    expect(samples.perPotency(1, 'damage')).toBe(10)
    // all 700: 400 of 10 and 300 of 20
    expect(samples.perPotency(1, 'damage', true)).toBe(10)
    samples.clear()
    expect(samples.count(1, 'damage')).toBe(0)
  })
  it('takes the median of ρ over the casters of the kind', () => {
    const samples = new CalibrationSamples()
    samples.add(1, 'damage', 1, 40)
    samples.add(2, 'damage', 1, 30)
    samples.add(3, 'damage', 1, 50)
    expect(samples.medianPerPotency('damage')).toBe(40)
    samples.add(4, 'damage', 1, 10)
    expect(samples.medianPerPotency('damage')).toBe(35)
  })

  it('has no median without samples of the kind', () => {
    const samples = new CalibrationSamples()
    samples.add(1, 'heal', 1, 30)
    expect(samples.medianPerPotency('damage')).toBeNull()
    expect(samples.medianPerPotency('heal')).toBe(30)
  })

  it('takes ρ of the last 300 samples of each caster, or of all of them', () => {
    const samples = new CalibrationSamples()
    for (let index = 0; index < 400; index++) samples.add(1, 'damage', 1, 10)
    for (let index = 0; index < CALIBRATION_WINDOW; index++) samples.add(1, 'damage', 1, 20)
    samples.add(2, 'damage', 1, 15)
    samples.add(3, 'damage', 1, 50)
    // Caster 1 has ρ 20 in the window and 10 over all its samples
    expect(samples.medianPerPotency('damage')).toBe(20)
    expect(samples.medianPerPotency('damage', true)).toBe(15)
  })
})
