import type { ClockState } from '@ffcafe/mojito-plugin-sdk'
import { describe, expect, it } from 'vitest'
import { anchor } from './page.js'

const clock = (now: number | null, patch: Partial<ClockState> = {}): ClockState => ({
  now,
  source: 'replay',
  base: 'packet-unix',
  generation: 1,
  paused: false,
  ...patch,
})
describe('adjacent clock samples', () => {
  it('uses source deltas and fixes live rate at one', () => {
    const first = anchor(null, clock(1000), 0)
    expect(first.rate).toBe(0)
    const double = anchor(first, clock(3000), 1000)
    expect(double.rate).toBe(2)
    expect(anchor(double, clock(4000), 2000).rate).toBe(1)
    expect(anchor(null, clock(0, { source: 'live' }), 0).rate).toBe(1)
  })
  it('excludes a long pause and starts a fresh adjacent pair on resume', () => {
    const running = anchor(anchor(null, clock(1000), 0), clock(3000), 1000)
    const paused = anchor(running, clock(3500, { paused: true }), 1250)
    const still = anchor(paused, clock(3500, { paused: true }), 91250)
    const resumed = anchor(still, clock(3500), 101250)
    expect([paused.rate, still.rate, resumed.rate]).toEqual([2, 2, 2])
    expect(resumed.clock.now).toBe(3500)
    expect(anchor(resumed, clock(4500), 102250).rate).toBe(1)
  })
  it.each([{ generation: 2 }, { base: 'host-monotonic-unix' as const }, { source: null, now: null, base: null }])(
    'discards the baseline on %j',
    (patch) => {
      const old = anchor(anchor(null, clock(1000), 0), clock(3000), 1000)
      expect(anchor(old, clock(500, patch), 2000).rate).toBe(0)
    },
  )
  it('keeps empty, repeated and backwards samples finite', () => {
    const empty = anchor(null, clock(null, { source: null, base: null }), 0)
    const first = anchor(empty, clock(1000), 0)
    const repeated = anchor(first, clock(1000), 0)
    expect(repeated.rate).toBe(0)
    expect(anchor(repeated, clock(500), 1000).rate).toBe(0)
  })
})
