import { describe, expect, it } from 'vitest'
import { ENTRY_FIELDS, type Entries, type ReplayActor } from '../view-model.js'
import { bossEvents } from './bosses.js'

const enemy = (index: number, samples: [number, number][], main = false): ReplayActor => ({
  index,
  key: `enemy:${index}`,
  name: `敌人${index}`,
  kind: 'enemy',
  owner: null,
  main,
  job: null,
  role: null,
  track: {
    t: Uint32Array.from(samples, ([t]) => t),
    x: new Float32Array(samples.length),
    z: new Float32Array(samples.length),
    rotation: new Float32Array(samples.length),
    hp: Float32Array.from(samples, ([, hp]) => hp),
  },
})
/** Damage of member 0 on each target */
const damage = (amounts: [number, number][]): Entries => ({
  t: new Uint32Array(amounts.length),
  actor: new Uint16Array(amounts.length),
  other: Int32Array.from(amounts, ([target]) => target),
  skill: new Uint16Array(amounts.length),
  field: new Uint8Array(amounts.length).fill(ENTRY_FIELDS.indexOf('damage')),
  hit: new Uint8Array(amounts.length),
  amount: Float64Array.from(amounts, ([, amount]) => amount),
})

it('takes the main enemy and the enemies that took a tenth of its damage as bosses', () => {
  const actors = [enemy(1, [[0, 1]], true), enemy(2, [[1000, 1]]), enemy(3, [[2000, 1]])]
  const events = bossEvents(
    actors,
    damage([
      [1, 600],
      [1, 400],
      [2, 100],
      [3, 99],
    ]),
    new Map(),
    10_000,
  )
  expect(events.flatMap((event) => (event.kind === 'bossIn' ? [event.actor] : []))).toEqual([1, 2])
})

it('has no bosses without a main enemy', () => {
  expect(bossEvents([enemy(1, [[0, 1]])], damage([[1, 100]]), new Map(), 10_000)).toEqual([])
})

it('marks when each boss came, fell or left', () => {
  const actors = [
    // Present from the start and still there at the end
    enemy(
      1,
      [
        [0, 0.5],
        [9500, 0.4],
      ],
      true,
    ),
    // Killed
    enemy(2, [
      [1000, 1],
      [3000, 0.2],
    ]),
    // At zero HP without an actorDied
    enemy(3, [
      [2000, 1],
      [4000, 0],
    ]),
    // Left the field at 10.4%
    enemy(4, [
      [2500, 1],
      [5000, 0.104],
    ]),
  ]
  const events = bossEvents(actors, damage([1, 2, 3, 4].map((index) => [index, 100])), new Map([[2, 3500]]), 10_000)
  expect(events).toEqual([
    { kind: 'bossIn', t: 0, actor: 1 },
    { kind: 'bossIn', t: 1000, actor: 2 },
    { kind: 'bossIn', t: 2000, actor: 3 },
    { kind: 'bossIn', t: 2500, actor: 4 },
    { kind: 'bossDown', t: 3500, actor: 2 },
    { kind: 'bossDown', t: 4000, actor: 3 },
    { kind: 'bossOut', t: 5000, actor: 4, reason: 'left' },
  ])
})

describe('with targetable changes', () => {
  const boss = (samples: [number, number][]) => [enemy(1, samples, true)]
  const hits = damage([[1, 100]])
  const change = (t: number, targetable: boolean) => ({ t, actor: 1, targetable })
  const present: [number, number][] = [
    [0, 1],
    [9500, 0.5],
  ]

  it('brings a boss that starts untargetable when it first becomes targetable', () => {
    expect(bossEvents(boss(present), hits, new Map(), 10_000, [change(3000, true)])).toEqual([
      { kind: 'bossIn', t: 3000, actor: 1 },
    ])
    expect(bossEvents(boss(present), hits, new Map(), 10_000, [change(0, false), change(3000, true)])).toEqual([
      { kind: 'bossIn', t: 3000, actor: 1 },
    ])
  })

  it('takes a change at time 0 as the state the fight starts in', () => {
    expect(bossEvents(boss(present), hits, new Map(), 10_000, [change(0, true)])).toEqual([
      { kind: 'bossIn', t: 0, actor: 1 },
    ])
  })

  it('lists every coming and leaving of a boss that keeps switching', () => {
    const changes = [change(0, true), change(2000, false), change(4000, true), change(6000, false), change(8000, true)]
    expect(bossEvents(boss(present), hits, new Map(), 10_000, changes)).toEqual([
      { kind: 'bossIn', t: 0, actor: 1 },
      { kind: 'bossOut', t: 2000, actor: 1, reason: 'untargetable' },
      { kind: 'bossIn', t: 4000, actor: 1 },
      { kind: 'bossOut', t: 6000, actor: 1, reason: 'untargetable' },
      { kind: 'bossIn', t: 8000, actor: 1 },
    ])
  })

  it('takes a first change to untargetable as the leaving of a boss that was there', () => {
    expect(bossEvents(boss(present), hits, new Map(), 10_000, [change(2000, false), change(4000, true)])).toEqual([
      { kind: 'bossIn', t: 0, actor: 1 },
      { kind: 'bossOut', t: 2000, actor: 1, reason: 'untargetable' },
      { kind: 'bossIn', t: 4000, actor: 1 },
    ])
  })

  it('lists no event for a repeated state', () => {
    const changes = [change(0, true), change(1000, true), change(2000, false), change(3000, false)]
    expect(bossEvents(boss(present), hits, new Map(), 10_000, changes)).toEqual([
      { kind: 'bossIn', t: 0, actor: 1 },
      { kind: 'bossOut', t: 2000, actor: 1, reason: 'untargetable' },
    ])
  })

  it('reads the changes in time order', () => {
    expect(bossEvents(boss(present), hits, new Map(), 10_000, [change(4000, true), change(2000, false)])).toEqual([
      { kind: 'bossIn', t: 0, actor: 1 },
      { kind: 'bossOut', t: 2000, actor: 1, reason: 'untargetable' },
      { kind: 'bossIn', t: 4000, actor: 1 },
    ])
  })

  it('lists no leaving for the change that comes with the fall of the boss', () => {
    const down = new Map([[1, 5000]])
    for (const t of [4000, 4500, 5000, 5500])
      expect(bossEvents(boss(present), hits, down, 10_000, [change(t, false)])).toEqual([
        { kind: 'bossIn', t: 0, actor: 1 },
        { kind: 'bossDown', t: 5000, actor: 1 },
      ])
    expect(bossEvents(boss(present), hits, down, 10_000, [change(3999, false)])).toEqual([
      { kind: 'bossIn', t: 0, actor: 1 },
      { kind: 'bossOut', t: 3999, actor: 1, reason: 'untargetable' },
      { kind: 'bossDown', t: 5000, actor: 1 },
    ])
  })

  it('lists no second leaving when an untargetable boss leaves the field', () => {
    const gone: [number, number][] = [
      [0, 1],
      [5000, 0.5],
    ]
    expect(bossEvents(boss(gone), hits, new Map(), 10_000, [change(3000, false)])).toEqual([
      { kind: 'bossIn', t: 0, actor: 1 },
      { kind: 'bossOut', t: 3000, actor: 1, reason: 'untargetable' },
    ])
    expect(bossEvents(boss(gone), hits, new Map(), 10_000, [change(3000, false), change(4000, true)])).toEqual([
      { kind: 'bossIn', t: 0, actor: 1 },
      { kind: 'bossOut', t: 3000, actor: 1, reason: 'untargetable' },
      { kind: 'bossIn', t: 4000, actor: 1 },
      { kind: 'bossOut', t: 5000, actor: 1, reason: 'left' },
    ])
  })

  it('ignores the changes of other enemies', () => {
    expect(bossEvents(boss(present), hits, new Map(), 10_000, [{ t: 2000, actor: 7, targetable: false }])).toEqual([
      { kind: 'bossIn', t: 0, actor: 1 },
    ])
  })
})
