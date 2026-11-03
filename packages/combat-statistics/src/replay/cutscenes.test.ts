import { expect, it } from 'vitest'
import { cutsceneEvents } from './cutscenes.js'

const change = (t: number, playing: boolean) => ({ t, playing })

it('gives each cutscene a start and an end with the same range', () => {
  expect(cutsceneEvents([change(1000, true), change(3000, false)], 10_000)).toEqual([
    { kind: 'cutscene', t: 1000, edge: 'start', from: 1000, to: 3000 },
    { kind: 'cutscene', t: 3000, edge: 'end', from: 1000, to: 3000 },
  ])
})

it('starts a cutscene at 0 when the first change ends it', () => {
  expect(cutsceneEvents([change(2000, false)], 10_000)).toEqual([
    { kind: 'cutscene', t: 0, edge: 'start', from: 0, to: 2000 },
    { kind: 'cutscene', t: 2000, edge: 'end', from: 0, to: 2000 },
  ])
})

it('ends a cutscene still playing with the fight', () => {
  expect(cutsceneEvents([change(8000, true)], 10_000)).toEqual([
    { kind: 'cutscene', t: 8000, edge: 'start', from: 8000, to: 10_000 },
    { kind: 'cutscene', t: 10_000, edge: 'end', from: 8000, to: 10_000 },
  ])
})

it('ignores repeated states and reads the changes in time order', () => {
  const changes = [change(3000, false), change(1000, true), change(2000, true), change(4000, false)]
  expect(cutsceneEvents(changes, 10_000)).toEqual([
    { kind: 'cutscene', t: 1000, edge: 'start', from: 1000, to: 3000 },
    { kind: 'cutscene', t: 3000, edge: 'end', from: 1000, to: 3000 },
  ])
})

it('gives nothing for a cutscene without length or no changes', () => {
  expect(cutsceneEvents([], 10_000)).toEqual([])
  expect(cutsceneEvents([change(0, false)], 10_000)).toEqual([])
  expect(cutsceneEvents([change(2000, true), change(2000, false)], 10_000)).toEqual([])
  expect(cutsceneEvents([change(10_000, true)], 10_000)).toEqual([])
})
