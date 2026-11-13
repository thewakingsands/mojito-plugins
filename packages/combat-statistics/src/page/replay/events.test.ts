import { expect, it } from 'vitest'
import type { ReplayEvent } from '../../view-model.js'
import { countTypes, cutscenesOf, DEFAULT_TYPES, lastBefore, listedEvents, ofTypes, typeOf } from './events.js'

const events: ReplayEvent[] = [
  { kind: 'bossIn', t: 0, actor: 9 },
  { kind: 'death', t: 1000, actor: 0, killingBlow: null, recentHits: [], maxHp: null, statuses: [] },
  {
    kind: 'penalty',
    t: 2000,
    actor: 1,
    statusId: 215,
    name: null,
    durationMs: null,
    stacks: null,
    cause: { source: null, sourceName: null, actionId: null, name: null },
  },
  { kind: 'bossDown', t: 3000, actor: 9 },
]

it('lists the events of the chosen members and every boss event, within the span', () => {
  expect(listedEvents(events, new Set([1]), null).map((event) => event.t)).toEqual([0, 2000, 3000])
  expect(listedEvents(events, new Set([0, 1]), { from: 1000, to: 3000 }).map((event) => event.t)).toEqual([1000, 2000])
})

it('finds the last event at or before a time', () => {
  expect(lastBefore(events, -1)).toBe(-1)
  expect(lastBefore(events, 2000)).toBe(2)
  expect(lastBefore(events, 99_000)).toBe(3)
})

const cutscene = { kind: 'cutscene', t: 500, edge: 'start', from: 500, to: 1500 } as const
const cutsceneEnd = { ...cutscene, t: 1500, edge: 'end' } as const

it('lists the cutscenes whatever members are chosen, within the span by the time of each edge', () => {
  const all = [cutscene, cutsceneEnd]
  expect(listedEvents(all, new Set(), null)).toEqual(all)
  expect(listedEvents(all, new Set(), { from: 1000, to: 2000 })).toEqual([cutsceneEnd])
})

it('gives one event for each cutscene', () => {
  expect(cutscenesOf([...events, cutscene, cutsceneEnd])).toEqual([cutscene])
})

const bigHit = {
  kind: 'bigHit',
  t: 2500,
  actor: 0,
  hit: { t: 2500, source: 9, sourceName: null, actionId: 1, name: null, amount: 900, periodic: false },
  maxHp: 1000,
  statuses: [],
} as const satisfies ReplayEvent

it('sorts the events into the types of the list, cutscenes with the boss', () => {
  expect([...events, bigHit, cutscene].map(typeOf)).toEqual(['boss', 'death', 'penalty', 'boss', 'bigHit', 'boss'])
})

it('counts the types of what the members and the span leave', () => {
  const all = [...events, bigHit]
  expect(countTypes(listedEvents(all, new Set([0, 1]), null))).toEqual({ death: 1, penalty: 1, boss: 2, bigHit: 1 })
  expect(countTypes(listedEvents(all, new Set([1]), { from: 1500, to: 2600 }))).toEqual({
    death: 0,
    penalty: 1,
    boss: 0,
    bigHit: 0,
  })
})

it('leaves the big hits out by default', () => {
  expect(ofTypes([...events, bigHit], DEFAULT_TYPES)).toEqual(events)
  expect(ofTypes([...events, bigHit], new Set(['bigHit']))).toEqual([bigHit])
})
