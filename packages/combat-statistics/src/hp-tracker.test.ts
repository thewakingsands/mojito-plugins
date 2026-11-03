import { expect, it } from 'vitest'
import { HpTracker } from './hp-tracker.js'

it('keeps the maximum HP of EffectResult for the HP events without it', () => {
  const tracker = new HpTracker()
  tracker.apply(1, 5000, null, 100, true)
  expect(tracker.current(1)).toEqual({ hpCur: 5000, hpMax: null, at: 100, fromHpUpdate: true })
  tracker.apply(1, 6000, 10000, 200, false)
  tracker.apply(1, 7000, null, 300, false)
  tracker.apply(1, 8000, null, 400, true)
  expect(tracker.current(1)).toEqual({ hpCur: 8000, hpMax: 10000, at: 400, fromHpUpdate: true })
  expect(tracker.current(2)).toBeNull()
})
it('uses the entry before an UpdateHpMpTp of the same timestamp as the HP before a tick', () => {
  const tracker = new HpTracker()
  tracker.apply(1, 9000, 10000, 100, false)
  tracker.apply(1, 9500, null, 200, true)
  expect(tracker.beforeTick(1, 200)).toMatchObject({ hpCur: 9000, hpMax: 10000 })
  expect(tracker.beforeTick(1, 300)).toMatchObject({ hpCur: 9500, hpMax: 10000 })
  expect(tracker.beforeTick(1, undefined)).toMatchObject({ hpCur: 9500 })
  tracker.apply(1, 9800, null, 300, false)
  expect(tracker.beforeTick(1, 300)).toMatchObject({ hpCur: 9800 })
  tracker.apply(2, 100, null, 400, true)
  expect(tracker.beforeTick(2, 400)).toBeNull()
  tracker.clear()
  expect(tracker.current(1)).toBeNull()
  expect(tracker.beforeTick(1, 300)).toBeNull()
})
