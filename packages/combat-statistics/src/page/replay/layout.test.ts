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

it('keeps the collapsed panel at its width, at most 40% of the row, unless the map would get too narrow', () => {
  expect(panelWidth(1400, false, null)).toBe(PANEL_COLLAPSED)
  expect(panelWidth(1400, false, 800)).toBe(PANEL_COLLAPSED)
  expect(panelWidth(692, false, null)).toBeCloseTo(692 * 0.4)
  expect(panelWidth(1036, false, null)).toBe(PANEL_COLLAPSED)
  expect(panelWidth(400, false, null)).toBe(400 - MIN_MAP_WIDTH)
  expect(panelWidth(200, false, null)).toBe(0)
})

it('gives the panel the whole row while the map is hidden', () => {
  expect(panelWidth(692, false, null, null, true)).toBe(692)
  expect(panelWidth(1036, true, 500, 640, true)).toBe(1036)
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
  expect(panelWidth(500, true, 100)).toBe(500 * 0.4)
})

it('keeps the middle row at least 120 pixels high with the timeline expanded', () => {
  expect(bottomHeight(900, null)).toBeNull()
  expect(bottomLimit(900)).toBe(900 - MIN_MIDDLE_HEIGHT)
  expect(bottomHeight(900, 400)).toBe(400)
  expect(bottomHeight(900, 800)).toBe(900 - MIN_MIDDLE_HEIGHT)
  expect(bottomHeight(900, 100)).toBe(MIN_BOTTOM)
  // On a page too small for both minimums, the timeline keeps its own
  expect(bottomLimit(300)).toBe(MIN_BOTTOM)
  expect(bottomHeight(300, 500)).toBe(MIN_BOTTOM)
})

it('leaves the middle row room in the smallest window and in a common one', () => {
  // The room under the header of a 692×410 and a 1036×640 page
  expect(bottomLimit(370)).toBe(250)
  expect(bottomHeight(370, 400)).toBe(250)
  expect(bottomLimit(600)).toBe(480)
  expect(bottomHeight(600, 300)).toBe(300)
  expect(panelWidth(692, true, null, 640)).toBe(692 - MIN_MAP_WIDTH)
  expect(panelWidth(1036, true, null, 640)).toBe(640)
})
