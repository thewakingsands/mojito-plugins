import { expect, it } from 'vitest'
import { ringRotation } from './facing.js'

it('turns the ring so its arrow points where the actor faces', () => {
  expect(ringRotation(0)).toBe(180)
  expect(ringRotation(Math.PI / 2)).toBeCloseTo(90)
  expect(ringRotation(Math.PI)).toBeCloseTo(0)
})
