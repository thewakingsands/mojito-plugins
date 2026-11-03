import { expect, it } from 'vitest'
import { tick } from '../fixtures.js'
import { replay } from '../log/replay.js'
import type { LogRecord } from '../log/types.js'
import type { ReplayData, ReplayEvent } from '../view-model.js'
import { complete, type PartialReplay, ReplayBuilder } from './builder.js'
import { cast, changed, died, event, hit, keyOf, positions, replaced, status, visit } from './records.test-helper.js'

async function build(fight: LogRecord[]): Promise<PartialReplay> {
  const builder = new ReplayBuilder('f1', { visitId: 'v', startAt: 10_000, endAt: 30_000 })
  await replay(visit(fight), builder)
  return builder.finish(keyOf(9))
}
const actor = (data: PartialReplay, id: number) => data.actors.find((item) => item.key === keyOf(id))
const indexOf = (data: PartialReplay, id: number) => actor(data, id)!.index
const eventsOf = <K extends ReplayEvent['kind']>(data: { events: ReplayEvent[] }, kind: K) =>
  data.events.filter((item): item is Extract<ReplayEvent, { kind: K }> => item.kind === kind)

it('collects only the records of its fight and cuts casts at its end', async () => {
  const data = await build([
    hit(10_000, 1, [9, 8], 1000),
    positions(10_000, [1, 1], [9, 2], [7, 3]),
    cast(11_000, 9, 500, 3000),
    cast(11_500, 8, 501, 3000),
    cast(17_000, 9, 502, 20_000),
  ])
  expect(data.fight).toEqual({ visitId: 'v', fightId: 'f1', durationMs: 20_000 })
  expect([...actor(data, 1)!.track.t]).toEqual([0])
  expect([...actor(data, 1)!.track.x]).toEqual([1])
  expect(data.casts).toEqual([
    { t: 1000, actor: indexOf(data, 9), durationMs: 3000, actionId: 500, name: null, cancelledAt: null },
    { t: 7000, actor: indexOf(data, 9), durationMs: 13_000, actionId: 502, name: null, cancelledAt: null },
  ])
  expect(data.actors.find((item) => item.key === keyOf(8))).toMatchObject({ kind: 'enemy', main: false })
  expect(actor(data, 9)).toMatchObject({ kind: 'enemy', main: true, name: '敌人9' })
  expect(actor(data, 1)).toMatchObject({ kind: 'member', name: '骑士', job: 19, role: 'tank' })
})

it('drops enemies nobody damaged, and puts the uses of a pet under its owner', async () => {
  const data = await build([
    hit(10_000, 1, [9, 8], 1000, { sequence: 100 }),
    positions(10_000, [7, 3]),
    hit(10_100, 1, [9], 10, { actionId: 7 }),
    hit(10_200, 3, [9], 300, { actionId: 100 }),
  ])
  expect(actor(data, 7)).toBeUndefined()
  const pet = actor(data, 3)!
  expect(pet).toMatchObject({ kind: 'pet', owner: indexOf(data, 1) })
  expect(pet.track.t).toHaveLength(0)
  // The two targets of one sequence make one use, the auto-attack none
  expect([...data.uses.actor]).toEqual([indexOf(data, 1), indexOf(data, 1)])
  expect([...data.uses.action].map((index) => data.actionIds[index])).toEqual([9, 100])
})

it('marks the uses of raid buffs and party mitigations with their lane and duration', async () => {
  const data = complete(
    await build([
      hit(10_000, 1, [9], 1000),
      hit(10_100, 2, [9], 10, { actionId: 16536 }),
      hit(10_200, 2, [9], 10, { actionId: 7436 }),
    ]),
    { action: (id) => `技能${id}`, status: () => null, gcd: (id) => id === 9, category: () => null },
  )
  expect(data.actions).toEqual([
    { actionId: 9, name: '技能9', gcd: true, lane: null, durationMs: null },
    { actionId: 16536, name: '技能16536', gcd: false, lane: 'mitigation', durationMs: 20_000 },
    { actionId: 7436, name: '技能7436', gcd: false, lane: 'buff', durationMs: 20_000 },
  ])
})

it('records a death with its killing blow, the hits of the 10 seconds before and the statuses on the member', async () => {
  const data = await build([
    hit(10_000, 1, [9], 1000),
    positions(10_000, [1, 0]),
    hit(13_000, 9, [1], 200, { actionId: 600 }),
    changed(13_500, 1, 1, status(1000, 2)),
    event(
      {
        type: 'periodicTick',
        data: tick({
          occurredAt: 20_000,
          target: 1,
          statusId: 700,
          total: 100,
          unknown: 0,
          shares: [{ sourceId: 9, statusId: 700, amount: 100, basis: 'exact' }],
        }),
      },
      20_000,
    ),
    hit(23_000, 9, [1], 300, { actionId: 601 }),
    hit(23_500, 9, [1], 600, { actionId: 602 }),
    died(24_000, 1),
  ])
  const [death] = eventsOf(data, 'death')
  const enemy = { source: indexOf(data, 9), sourceName: '敌人9', name: null }
  expect(death).toMatchObject({ t: 14_000, actor: indexOf(data, 1), maxHp: 1000 })
  expect(death.killingBlow).toEqual({ t: 13_500, actionId: 602, amount: 600, periodic: false, ...enemy })
  expect(death.recentHits).toEqual([
    { t: 13_500, actionId: 602, amount: 600, periodic: false, ...enemy },
    { t: 13_000, actionId: 601, amount: 300, periodic: false, ...enemy },
    // Damage over time has no source actor
    { t: 10_000, source: null, sourceName: null, actionId: 700, name: null, amount: 100, periodic: true },
  ])
  expect(death.statuses).toEqual([{ statusId: 1000, name: null, since: 3500 }])
  // The hit of 60% killed within a second, so it is no big hit
  expect(eventsOf(data, 'bigHit')).toEqual([])
})

it('records penalties from statusChanged and statusesReplaced with the enemy effect that caused them', async () => {
  const data = await build([
    hit(10_000, 1, [9, 8], 1000),
    hit(13_000, 9, [1], 200, { actionId: 600 }),
    changed(13_500, 1, 1, status(215, 9)),
    replaced(15_000, 2, [status(202, 9, 2)]),
    changed(15_500, 2, 0, status(1000, 2)),
    // An effect more than a second before is not the cause
    hit(16_000, 9, [5], 0, { actionId: 601 }),
    changed(17_500, 5, 0, status(696, 8)),
  ])
  const [one, two, five] = [1, 2, 5].map((id) => indexOf(data, id))
  expect(eventsOf(data, 'penalty')).toEqual([
    {
      kind: 'penalty',
      t: 3500,
      actor: one,
      statusId: 215,
      name: null,
      durationMs: 30000,
      stacks: null,
      cause: { source: indexOf(data, 9), sourceName: '敌人9', actionId: 600, name: null },
    },
    {
      kind: 'penalty',
      t: 5000,
      actor: two,
      statusId: 202,
      name: null,
      durationMs: 30000,
      stacks: 2,
      cause: { source: indexOf(data, 9), sourceName: '敌人9', actionId: null, name: null },
    },
    {
      kind: 'penalty',
      t: 7500,
      actor: five,
      statusId: 696,
      name: null,
      durationMs: 30000,
      stacks: null,
      cause: { source: indexOf(data, 8), sourceName: '敌人8', actionId: null, name: null },
    },
  ])
})

it('records a hit of half the maximum HP as a big hit unless the member dies within a second', async () => {
  const data = await build([
    hit(10_000, 1, [9], 1000),
    positions(10_000, [1, 0], [2, 0], [5, 0]),
    changed(10_500, 2, 0, status(1000, 2)),
    hit(11_000, 9, [2], 500, { actionId: 600 }),
    hit(12_000, 9, [2], 499, { actionId: 601 }),
    // Member 5 has no maximum HP
    hit(13_000, 9, [5], 900, { actionId: 602 }),
    hit(14_000, 9, [1], 900, { actionId: 603 }),
    died(15_100, 1),
    hit(22_000, 2, [9], 1000),
    // Within a second of the end, and the member lives to it
    hit(29_500, 9, [2], 800, { actionId: 604 }),
  ])
  const enemy = { source: indexOf(data, 9), sourceName: '敌人9', name: null, periodic: false }
  expect(eventsOf(data, 'bigHit')).toEqual([
    {
      kind: 'bigHit',
      t: 1000,
      actor: indexOf(data, 2),
      hit: { t: 1000, actionId: 600, amount: 500, ...enemy },
      maxHp: 1000,
      statuses: [{ statusId: 1000, name: null, since: 500 }],
    },
    {
      kind: 'bigHit',
      t: 4000,
      actor: indexOf(data, 1),
      hit: { t: 4000, actionId: 603, amount: 900, ...enemy },
      maxHp: 1000,
      statuses: [],
    },
    {
      kind: 'bigHit',
      t: 19_500,
      actor: indexOf(data, 2),
      hit: { t: 19_500, actionId: 604, amount: 800, ...enemy },
      maxHp: 1000,
      statuses: [{ statusId: 1000, name: null, since: 500 }],
    },
  ])
})

it('closes statuses when they go, when statusesReplaced leaves them out and at the end of the fight', async () => {
  const data = await build([
    hit(10_000, 1, [9], 1000),
    changed(12_000, 1, 0, status(1000, 2)),
    changed(14_000, 1, 0, null),
    replaced(15_000, 2, [status(1001, 2), status(1002, 1, 3)]),
    replaced(16_000, 2, [status(1002, 1, 3)]),
    changed(17_000, 9, 4, status(1003, 1)),
  ])
  const [one, two, boss] = [1, 2, 9].map((id) => indexOf(data, id))
  expect(data.statuses).toEqual([
    { actor: one, statusId: 1000, source: two, from: 2000, to: 4000, stacks: null },
    { actor: two, statusId: 1001, source: two, from: 5000, to: 6000, stacks: null },
    { actor: two, statusId: 1002, source: one, from: 5000, to: 20_000, stacks: 3 },
    { actor: boss, statusId: 1003, source: one, from: 7000, to: 20_000, stacks: null },
  ])
})

it('gives every column of a table the same length', async () => {
  const data = await build([
    hit(10_000, 1, [9, 8], 1000),
    positions(10_000, [1, 1], [9, 2]),
    positions(11_000, [1, 2], [9, 3]),
    hit(10_200, 3, [9], 300, { actionId: 100 }),
    hit(11_000, 9, [1], 200, { actionId: 600 }),
  ])
  const lengths = (table: object) => new Set(Object.values(table).map((column: ArrayLike<number>) => column.length))
  for (const table of [data.uses, data.entries, ...data.actors.map((item) => item.track)])
    expect(lengths(table).size).toBe(1)
  expect(data.entries.t.length).toBeGreaterThan(0)
  expect(data.uses.t.length).toBeGreaterThan(0)
  expect(new Set(data.skills).size).toBe(data.skills.length)
})

it('lists the Action or Status of every skill in the tables, used or not', async () => {
  const data = await build([
    hit(10_000, 1, [9], 1000),
    hit(10_100, 1, [9], 10, { actionId: 7 }),
    hit(11_000, 9, [1], 200, { actionId: 600 }),
    event(
      {
        type: 'periodicTick',
        data: tick({
          occurredAt: 12_000,
          target: 9,
          statusId: 700,
          total: 100,
          unknown: 0,
          shares: [{ sourceId: 1, statusId: 700, amount: 100, basis: 'exact' }],
        }),
      },
      12_000,
    ),
  ])
  expect(data.skills).toEqual(expect.arrayContaining(['action:7', 'action:600', 'status:700']))
  for (const key of data.skills) {
    const [kind, id] = key.split(':')
    expect(kind === 'action' ? data.actionIds : data.statusIds).toContain(Number(id))
  }
})

it('fills in the names of the game data', async () => {
  const partial = await build([
    hit(10_000, 1, [9], 1000),
    hit(13_000, 9, [1], 200, { actionId: 600 }),
    changed(13_500, 1, 1, status(215, 9)),
    cast(14_000, 9, 500, 1000),
    died(15_000, 1),
  ])
  const data: ReplayData = complete(partial, {
    action: (id) => `技能${id}`,
    status: (id) => `状态${id}`,
    gcd: () => null,
    category: (id) => (id === 215 ? 'debuff' : null),
  })
  expect(data.casts[0].name).toBe('技能500')
  expect(data.statusInfo).toContainEqual({ statusId: 215, name: '状态215', category: 'debuff' })
  expect(eventsOf(data, 'penalty')[0]).toMatchObject({ name: '状态215', cause: { name: '技能600' } })
  expect(eventsOf(data, 'death')[0]).toMatchObject({
    killingBlow: { name: '技能600' },
    statuses: [{ statusId: 215, name: '状态215' }],
  })
})

const potencySample = (at: number, casterId: number, extra: object = {}) =>
  event(
    {
      type: 'potencySample',
      data: {
        casterId,
        targetId: 9,
        actionId: 9,
        sequence: 1,
        amount: 9000,
        potency: 200,
        multiplier: 1,
        factors: [],
        ...extra,
      },
    },
    at,
  )
it('collects the potency samples of members in the fight, with the indices of their actors', async () => {
  const builder = new ReplayBuilder('f1', { visitId: 'v', startAt: 10_000, endAt: 25_000 })
  await replay(
    visit([
      hit(10_000, 1, [9], 1000),
      potencySample(12_000, 1, {
        multiplier: 1.272,
        factors: [
          { statusId: 1878, sourceId: 2, holder: 'caster', value: 1.06 },
          { statusId: 0, sourceId: null, holder: 'caster', value: 1.2 },
          { statusId: 2000, sourceId: 77, holder: 'target', value: 1.05 },
        ],
      }),
      potencySample(11_000, 2, { targetId: 77 }),
      // A pet, an enemy, no potency, and after the end the builder was given
      potencySample(11_500, 3),
      potencySample(11_600, 9),
      potencySample(11_700, 1, { potency: 0 }),
      potencySample(26_000, 1),
    ]),
    builder,
  )
  const data = complete(builder.finish(keyOf(9)), {
    action: () => null,
    status: (id) => `状态${id}`,
    gcd: () => null,
    category: () => null,
  })
  const index = (id: number) => data.actors.find((item) => item.key === keyOf(id))!.index
  expect(data.potency).toEqual([
    {
      t: 1000,
      actor: index(2),
      target: -1,
      actionId: 9,
      amount: 9000,
      potency: 200,
      multiplier: 1,
      factors: [],
    },
    {
      t: 2000,
      actor: index(1),
      target: index(9),
      actionId: 9,
      amount: 9000,
      potency: 200,
      multiplier: 1.272,
      factors: [
        { statusId: 1878, source: index(2), holder: 'caster', value: 1.06 },
        { statusId: 0, source: null, holder: 'caster', value: 1.2 },
        { statusId: 2000, source: null, holder: 'target', value: 1.05 },
      ],
    },
  ])
  expect(data.statusInfo.map((info) => info.statusId)).toEqual(expect.arrayContaining([1878, 2000]))
  expect(data.statusInfo.map((info) => info.statusId)).not.toContain(0)
})

const targetable = (at: number, actorId: number, value: boolean) =>
  event({ type: 'targetableChanged', data: { actorId, targetable: value } }, at)
const cutscene = (at: number, playing: boolean) => event({ type: 'cutsceneChanged', data: { playing } }, at)
/** The visit with records before the fight and after its end */
async function buildAround(before: LogRecord[], fight: LogRecord[], after: LogRecord[] = []) {
  const records = visit(fight)
  const end = records.findIndex((record) => record.kind === 'fightEnd' && record.fight === 1)
  records.splice(end + 1, 0, ...after)
  records.splice(
    records.findIndex((record) => record.kind === 'fightStart' && record.fight === 1),
    0,
    ...before,
  )
  const builder = new ReplayBuilder('f1', { visitId: 'v', startAt: 10_000, endAt: 30_000 })
  await replay(records, builder)
  return builder.finish(keyOf(9))
}

it('makes boss events from the targetable changes in the fight, without counting them as statistics', async () => {
  const data = await build([
    hit(10_000, 1, [9], 1000),
    positions(10_000, [9, 0]),
    positions(29_500, [9, 0]),
    targetable(12_000, 9, true),
    targetable(14_000, 9, false),
    targetable(16_000, 9, true),
  ])
  expect(data.events.filter((item) => item.kind.startsWith('boss'))).toEqual([
    { kind: 'bossIn', t: 2000, actor: indexOf(data, 9) },
    { kind: 'bossOut', t: 4000, actor: indexOf(data, 9), reason: 'untargetable' },
    { kind: 'bossIn', t: 6000, actor: indexOf(data, 9) },
  ])
})

it('takes the last state before the fight as the one it starts in, and ignores what comes after it', async () => {
  const data = await buildAround(
    [targetable(3000, 9, true), targetable(4000, 9, false), cutscene(5000, false), cutscene(6000, true)],
    [hit(10_000, 1, [9], 1000), positions(10_000, [9, 0]), positions(29_500, [9, 0]), cutscene(12_000, false)],
    [targetable(31_000, 9, true), cutscene(32_000, true)],
  )
  // Untargetable from the start and never back, so the boss does not come
  expect(eventsOf(data, 'bossIn')).toEqual([])
  expect(eventsOf(data, 'bossOut')).toEqual([])
  expect(eventsOf(data, 'cutscene')).toEqual([
    { kind: 'cutscene', t: 0, edge: 'start', from: 0, to: 2000 },
    { kind: 'cutscene', t: 2000, edge: 'end', from: 0, to: 2000 },
  ])
})

it('does not bring an enemy into the review for its targetable changes alone', async () => {
  const data = await build([hit(10_000, 1, [9], 1000), targetable(12_000, 7, false)])
  expect(actor(data, 7)).toBeUndefined()
})

it('ends a cutscene that goes on past the fight with the fight, in time order with the other events', async () => {
  const data = await build([
    hit(10_000, 1, [9], 1000),
    positions(10_000, [9, 0]),
    positions(29_500, [9, 0]),
    cutscene(25_000, true),
  ])
  expect(data.events.map((item) => [item.kind, item.t])).toEqual([
    ['bossIn', 0],
    ['cutscene', 15_000],
    ['cutscene', 20_000],
  ])
})

it('gives the same boss events and no cutscene for a log without these changes', async () => {
  const data = await build([hit(10_000, 1, [9], 1000), positions(10_000, [9, 0]), positions(15_000, [9, 0])])
  expect(data.events).toEqual([
    { kind: 'bossIn', t: 0, actor: indexOf(data, 9) },
    { kind: 'bossOut', t: 5000, actor: indexOf(data, 9), reason: 'left' },
  ])
})
