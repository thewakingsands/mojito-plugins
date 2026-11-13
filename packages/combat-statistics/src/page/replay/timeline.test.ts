import { expect, it } from 'vitest'
import { castLabelShown, clockText, follow, pressed, scrollWindow, tickStep, ticks, windowAround } from './timeline.js'

const duration = 300_000

it('centers the window of each zoom on the time, within the fight', () => {
  expect(windowAround(100_000, null, duration)).toEqual({ from: 0, to: duration })
  expect(windowAround(100_000, 120_000, duration)).toEqual({ from: 40_000, to: 160_000 })
  expect(windowAround(100_000, 60_000, duration)).toEqual({ from: 70_000, to: 130_000 })
  expect(windowAround(100_000, 30_000, duration)).toEqual({ from: 85_000, to: 115_000 })
  expect(windowAround(5000, 30_000, duration)).toEqual({ from: 0, to: 30_000 })
  expect(windowAround(299_000, 30_000, duration)).toEqual({ from: 270_000, to: duration })
  expect(windowAround(0, 120_000, 90_000)).toEqual({ from: 0, to: 90_000 })
  expect(scrollWindow({ from: 0, to: 30_000 }, -5000, duration)).toEqual({ from: 0, to: 30_000 })
  expect(scrollWindow({ from: 0, to: 30_000 }, 5000, duration)).toEqual({ from: 5000, to: 35_000 })
})

it('picks the smallest tick step that gives at most ten ticks', () => {
  expect(tickStep(30_000)).toBe(10_000)
  expect(tickStep(60_000)).toBe(10_000)
  expect(tickStep(120_000)).toBe(30_000)
  expect(tickStep(300_000)).toBe(30_000)
  expect(tickStep(600_000)).toBe(60_000)
  expect(tickStep(3_600_000)).toBe(120_000)
  expect(ticks({ from: 85_000, to: 115_000 })).toEqual([90_000, 100_000, 110_000])
})

it('moves the window on once the playhead passes nine tenths of it', () => {
  const window = { from: 0, to: 30_000 }
  expect(follow(window, 27_000, duration)).toBe(window)
  expect(follow(window, 28_000, duration)).toEqual({ from: 1000, to: 31_000 })
  expect(follow({ from: 270_000, to: duration }, 299_000, duration)).toEqual({ from: 270_000, to: duration })
  expect(follow(window, 100_000, duration)).toEqual({ from: 85_000, to: 115_000 })
})

it('takes a press on the ticks for a click up to four pixels, and for a selection beyond', () => {
  expect(pressed(1000, 1100, 4)).toEqual({ kind: 'click', time: 1000 })
  expect(pressed(5000, 2000, -5)).toEqual({ kind: 'select', span: { from: 2000, to: 5000 } })
})

it('writes review time with tenths of a second', () => {
  expect(clockText(185_250)).toBe('3:05.2')
  expect(clockText(0)).toBe('0:00.0')
})

it('writes the name of a cast only in a bar wide enough for all of it', () => {
  expect(castLabelShown(56, '大地摇动')).toBe(true)
  expect(castLabelShown(55, '大地摇动')).toBe(false)
  expect(castLabelShown(0, '')).toBe(false)
})
