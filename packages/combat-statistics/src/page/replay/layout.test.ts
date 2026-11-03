import { expect, it } from 'vitest'
import {
  bottomHeight,
  bottomLimit,
  MIN_BOTTOM,
  MIN_MAP_WIDTH,
  MIN_MIDDLE_HEIGHT,
  PANEL_COLLAPSED,
  panelLimit,
  panelWidth,
} from './layout.js'

it('keeps the collapsed panel at its width unless the map would get too narrow', () => {
  expect(panelWidth(1400, false, null)).toBe(PANEL_COLLAPSED)
  expect(panelWidth(1400, false, 800)).toBe(PANEL_COLLAPSED)
  expect(panelWidth(400, false, null)).toBe(400 - MIN_MAP_WIDTH)
  expect(panelWidth(200, false, null)).toBe(0)
})

it('gives an expanded panel that was never dragged the width measured for its content', () => {
  expect(panelWidth(1400, true, null)).toBeNull()
  expect(panelWidth(1400, true, null, 640)).toBe(640)
  expect(panelWidth(1400, true, 500, 640)).toBe(500)
  expect(panelWidth(800, true, null, 640)).toBe(800 - MIN_MAP_WIDTH)
  expect(panelLimit(1400)).toBe(1400 - MIN_MAP_WIDTH)
  expect(panelLimit(200)).toBe(0)
})

it('keeps a dragged panel between its collapsed width and what leaves the map its minimum', () => {
  expect(panelWidth(1400, true, 700)).toBe(700)
  expect(panelWidth(1400, true, 100)).toBe(PANEL_COLLAPSED)
  expect(panelWidth(1400, true, 1300)).toBe(1400 - MIN_MAP_WIDTH)
  expect(panelWidth(500, true, 100)).toBe(500 - MIN_MAP_WIDTH)
})

it('keeps the middle row at least 220 pixels high with the timeline expanded', () => {
  expect(bottomHeight(900, null)).toBeNull()
  expect(bottomLimit(900)).toBe(900 - MIN_MIDDLE_HEIGHT)
  expect(bottomHeight(900, 400)).toBe(400)
  expect(bottomHeight(900, 800)).toBe(900 - MIN_MIDDLE_HEIGHT)
  expect(bottomHeight(900, 100)).toBe(MIN_BOTTOM)
  // On a page too small for both minimums, the timeline keeps its own
  expect(bottomLimit(300)).toBe(MIN_BOTTOM)
  expect(bottomHeight(300, 500)).toBe(MIN_BOTTOM)
})
