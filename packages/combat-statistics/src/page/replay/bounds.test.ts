import { expect, it } from 'vitest'
import { gridLines, mapBounds, project } from './bounds.js'
import { track } from './data.test-helper.js'

const tracks = [
  track([
    [0, 0, 0],
    [1000, 10, 4],
  ]),
  track([[0, -4, 2]]),
]

it('leaves three meters around the actors', () => {
  // 20 × 10 meters with the margin, on a map of the same shape
  expect(mapBounds(tracks, 200, 100)).toEqual({ minX: -7, maxX: 13, minZ: -3, maxZ: 7 })
})

it('widens the short side about its center so both axes take the same scale', () => {
  const wide = mapBounds(tracks, 400, 100)!
  expect(wide).toEqual({ minX: -17, maxX: 23, minZ: -3, maxZ: 7 })
  const tall = mapBounds(tracks, 100, 100)!
  expect(tall).toEqual({ minX: -7, maxX: 13, minZ: -8, maxZ: 12 })
  for (const [bounds, width, height] of [
    [wide, 400, 100],
    [tall, 100, 100],
  ] as const)
    expect((bounds.maxX - bounds.minX) / width).toBeCloseTo((bounds.maxZ - bounds.minZ) / height)
  expect(project(tall, 100, 100, 3, 2)).toEqual([50, 50])
})

it('has no bounds without positions', () => {
  expect(mapBounds([track()], 100, 100)).toBeNull()
})

it('draws a grid line every five meters', () => {
  expect(gridLines(-7, 13)).toEqual([-5, 0, 5, 10])
  expect(gridLines(5, 10)).toEqual([5, 10])
})
