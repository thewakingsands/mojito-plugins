import { expect, it } from 'vitest'
import { nextSpeed, play, playhead } from './playback.js'

it.each([1, 2, 5, 10])('plays at %i×', (speed) => {
  const clock = play(1000, 60_000, 500, speed)
  expect(playhead(clock, 1500, 60_000)).toEqual({ time: 1000 + 1000 * speed, ended: false })
})

it('cycles the speeds of the host replay', () => {
  expect([1, 2, 5, 10].map(nextSpeed)).toEqual([2, 5, 10, 1])
})

it('stops at the end, and starts over when played there', () => {
  const clock = play(59_000, 60_000, 0, 2)
  expect(playhead(clock, 500, 60_000)).toEqual({ time: 60_000, ended: true })
  expect(play(60_000, 60_000, 0, 1).from).toBe(0)
})
