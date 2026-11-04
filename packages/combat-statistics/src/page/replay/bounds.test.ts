import { expect, it } from 'vitest'
import { fitBounds, gridLines, project } from './bounds.js'

it('widens a small box to thirty meters about its center', () => {
  // 500 pixels with 36 of padding on each side leave 428 for the thirty meters
  const bounds = fitBounds({ minX: 95, maxX: 105, minZ: 50, maxZ: 50 }, 500, 500)
  const span = (30 / 428) * 500
  expect(bounds.minX).toBeCloseTo(100 - span / 2)
  expect(bounds.maxX).toBeCloseTo(100 + span / 2)
  expect(bounds.minZ).toBeCloseTo(50 - span / 2)
  expect(bounds.maxZ).toBeCloseTo(50 + span / 2)
})

it('keeps the box inside the padding, at most 36 pixels on a large map', () => {
  const bounds = fitBounds({ minX: 0, maxX: 100, minZ: 0, maxZ: 40 }, 1000, 1000)
  expect(project(bounds, 1000, 1000, 0, 20)[0]).toBeCloseTo(36)
  expect(project(bounds, 1000, 1000, 100, 20)[0]).toBeCloseTo(964)
})

it('pads a small map by a fifth of its short side', () => {
  const bounds = fitBounds({ minX: 0, maxX: 60, minZ: 0, maxZ: 40 }, 100, 300)
  expect(project(bounds, 100, 300, 0, 20)[0]).toBeCloseTo(20)
  expect(project(bounds, 100, 300, 60, 20)[0]).toBeCloseTo(80)
})

it('gives both axes the same scale and shares the extra room between the two sides', () => {
  for (const [width, height] of [
    [800, 300],
    [300, 800],
  ]) {
    const bounds = fitBounds({ minX: 0, maxX: 60, minZ: 0, maxZ: 40 }, width, height)
    expect((bounds.maxX - bounds.minX) / width).toBeCloseTo((bounds.maxZ - bounds.minZ) / height)
    expect((bounds.minX + bounds.maxX) / 2).toBeCloseTo(30)
    expect((bounds.minZ + bounds.maxZ) / 2).toBeCloseTo(20)
  }
})

it('returns the box on a map not measured yet, which projects to its corner', () => {
  const box = { minX: 5, maxX: 5, minZ: 5, maxZ: 5 }
  expect(fitBounds(box, 0, 600)).toBe(box)
  expect(project(box, 0, 0, 5, 5)).toEqual([0, 0])
})

it('draws a grid line every five meters', () => {
  expect(gridLines(-7, 13)).toEqual([-5, 0, 5, 10])
  expect(gridLines(5, 10)).toEqual([5, 10])
})

it('projects a game position to pixels', () => {
  expect(project({ minX: -7, maxX: 13, minZ: -8, maxZ: 12 }, 100, 100, 3, 2)).toEqual([50, 50])
})
