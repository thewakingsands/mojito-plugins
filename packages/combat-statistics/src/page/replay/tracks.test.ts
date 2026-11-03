import { expect, it } from 'vitest'
import { track } from './data.test-helper.js'
import { enemyShown, isDown, memberShown, poseAt } from './tracks.js'

const path = track([
  [1000, 0, 0, 0, 1],
  [2000, 10, 20, 1, 0.5],
  [5000, 20, 20, 2, 0],
  [6000, 20, 20, 2, 0.8],
])

it('moves in a straight line between samples up to two seconds apart, facing as the nearer one', () => {
  expect(poseAt(path, 500)).toBeNull()
  expect(poseAt(path, 1000)).toEqual({ x: 0, z: 0, rotation: 0, hp: 1 })
  const pose = poseAt(path, 1600)!
  expect(pose.x).toBeCloseTo(6)
  expect(pose.z).toBeCloseTo(12)
  expect(pose.rotation).toBe(1)
  expect(pose.hp).toBeCloseTo(0.7)
})

it('stays at a sample until the next one when they are more than two seconds apart', () => {
  expect(poseAt(path, 4900)).toMatchObject({ x: 10, z: 20, rotation: 1 })
  expect(poseAt(path, 5000)).toMatchObject({ x: 20, z: 20, rotation: 2 })
  expect(poseAt(path, 9000)).toMatchObject({ x: 20, z: 20 })
})

it('shows a member from its first sample, down after its death until a sample with HP comes', () => {
  expect(memberShown(path, 999)).toBe(false)
  expect(memberShown(path, 1000)).toBe(true)
  expect(isDown(path, [4500], 4400)).toBe(false)
  expect(isDown(path, [4500], 4500)).toBe(true)
  // The sample at 5000 has no HP
  expect(isDown(path, [4500], 5500)).toBe(true)
  expect(isDown(path, [4500], 6000)).toBe(false)
})

it('shows an enemy until it dies, or a second after its last sample without a death', () => {
  expect(enemyShown(path, null, 999)).toBe(false)
  expect(enemyShown(path, 3000, 2999)).toBe(true)
  expect(enemyShown(path, 3000, 3000)).toBe(false)
  expect(enemyShown(path, null, 7000)).toBe(true)
  expect(enemyShown(path, null, 7001)).toBe(false)
  expect(enemyShown(track(), null, 0)).toBe(false)
})
