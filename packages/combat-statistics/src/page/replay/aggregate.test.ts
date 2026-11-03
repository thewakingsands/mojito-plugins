import type { GameEvent } from '@ffcafe/mojito-plugin-sdk'
import { expect, it } from 'vitest'
import { attribution } from '../../fixtures.js'
import { replay } from '../../log/replay.js'
import type { LogRecord } from '../../log/types.js'
import { ReplayBuilder } from '../../replay/builder.js'
import { event, hit, keyOf, visit } from '../../replay/records.test-helper.js'
import { HIT_CRITICAL, HIT_DIRECT, HIT_DIRECT_HIT } from '../../view-model.js'
import {
  damageRows,
  healByActor,
  healBySkill,
  healByTarget,
  type Scope,
  takenByActor,
  takenBySkill,
} from './aggregate.js'
import { enemy, member, pet, replayData } from './data.test-helper.js'

const scope = (patch: Partial<Scope> = {}): Scope => ({
  chosen: new Set([0, 1]),
  span: null,
  lengthMs: 10_000,
  mergePets: true,
  ...patch,
})
/** Members 0 and 1, pet 2 of member 0, enemy 3 */
const actors = [member(0, 19), member(1, 24), pet(2, 0), enemy(3, true)]

it('sums the whole fight of every member as the summary does, rDPS included', async () => {
  const split = (effect: LogRecord): LogRecord => {
    const { packet } = (effect as { sample: { value: GameEvent<'actionEffect'> } }).sample.value
    return event(
      {
        type: 'damageAttributed',
        packet,
        data: attribution({ contributions: [{ statusId: 786, sourceId: 1, amount: 600 }] }),
      },
      packet.timestamp,
    )
  }
  // Packets in the order they came: the ledger drops an effect older than the last
  const first = hit(10_000, 1, [9, 8], 1000)
  const given = hit(11_000, 2, [9], 10_000, { actionId: 10 })
  const records = visit([
    first,
    given,
    split(given),
    hit(12_000, 3, [9], 400, { actionId: 100 }),
    hit(13_000, 2, [1], 700, { actionId: 120, type: 4 }),
    hit(14_000, 9, [1], 300, { actionId: 600 }),
  ])
  const builder = new ReplayBuilder('f1', { visitId: 'v', startAt: 10_000, endAt: 30_000 })
  const summary = (await replay(records, builder)).find((item) => item.id === 'f1')!
  const data = { ...builder.finish(keyOf(9)), actions: [], statusInfo: [] }
  const members = data.actors.filter((actor) => actor.kind === 'member')
  const whole = scope({ chosen: new Set(members.map((actor) => actor.index)), lengthMs: summary.durationMs! })
  const total = (values: { total: number }[]) => values.reduce((sum, value) => sum + value.total, 0)
  for (const mergePets of [false, true]) {
    expect(total(damageRows(data, { ...whole, mergePets }, true))).toBe(
      summary.rows.reduce((sum, row) => sum + row.totals.damage, 0),
    )
    expect(total(healByActor(data, { ...whole, mergePets }, new Set()))).toBe(
      summary.rows.reduce((sum, row) => sum + row.totals.healing, 0),
    )
  }
  // The summary of a replay keeps pets apart
  const rows = damageRows(data, { ...whole, mergePets: false }, true)
  expect(rows).toHaveLength(summary.rows.length)
  for (const row of summary.rows) {
    const own = rows.find((item) => data.actors[item.actor].key === row.actor.key)!
    expect(own.total).toBe(row.totals.damage)
    expect(own.dps).toBeCloseTo(row.metrics.encDps.value!)
    expect(own.rdps).toBeCloseTo(row.metrics.contributionDps.value!)
  }
  const healer = summary.rows.find((row) => row.actor.key === keyOf(2))!
  const [taken] = takenByActor(data, whole)
  expect(taken).toMatchObject({ total: summary.rows.find((row) => row.actor.key === keyOf(1))!.totals.taken })
  expect(healer.contribution).toBe(9300)
})

const damage = replayData({
  actors,
  entries: [
    { t: 0, actor: 0, other: 3, skill: 'action:1', field: 'damage', amount: 1000, hit: HIT_DIRECT | HIT_CRITICAL },
    { t: 1000, actor: 0, other: 3, skill: 'action:1', field: 'damage', amount: 1000, hit: HIT_DIRECT },
    { t: 2000, actor: 0, other: 3, skill: 'status:5', field: 'damage', amount: 500 },
    { t: 2000, actor: 1, other: 3, skill: 'action:2', field: 'damage', amount: 2000, hit: HIT_DIRECT | HIT_DIRECT_HIT },
    // Member 1's split gives 300 of member 1's hit to member 0's status
    { t: 2000, actor: 1, skill: 'action:2', field: 'given', amount: -300 },
    { t: 2000, actor: 0, skill: 'status:786', field: 'received', amount: 300 },
    { t: 3000, actor: 2, other: 3, skill: 'action:3', field: 'damage', amount: 500, hit: HIT_DIRECT },
    // A revised tick takes back what it booked before
    { t: 4000, actor: 0, other: 3, skill: 'status:5', field: 'damage', amount: -200 },
    { t: 4000, actor: 0, other: 3, skill: 'status:5', field: 'damage', amount: 250 },
  ],
})

it('gives rDPS the parts members give and get, and the shares of every member whatever is chosen', () => {
  const [first, second] = damageRows(damage, scope(), true)
  expect(first).toMatchObject({ actor: 0, total: 3050, rdps: 335, dps: 305, critRate: 1 / 3, directRate: 0 })
  expect(second).toMatchObject({ actor: 1, total: 2000, rdps: 170, dps: 200, critRate: 0, directRate: 1 })
  expect(first.dpsShare).toBeCloseTo(3050 / 5050)
  expect(first.rdpsShare).toBeCloseTo(3350 / 5050)
  expect(first.skills.find((skill) => skill.skill === 'status:786')).toMatchObject({
    given: true,
    total: 0,
    rdps: 30,
  })
  // Damage over time has no critical or direct hits
  expect(first.skills.find((skill) => skill.skill === 'status:5')).toMatchObject({
    total: 550,
    critRate: null,
    directRate: null,
  })
  const [alone] = damageRows(damage, scope({ chosen: new Set([1]) }), true)
  expect(alone.actor).toBe(1)
  expect(alone.dpsShare).toBeCloseTo(2000 / 5050)
})

it('orders by DPS and leaves rDPS out when the fight has none', () => {
  const rows = damageRows(damage, scope(), false)
  expect(rows.map((row) => [row.actor, row.rdps, row.rdpsShare])).toEqual([
    [0, null, null],
    [1, null, null],
  ])
})

it('merges pets into their owners or keeps them apart', () => {
  expect(damageRows(damage, scope({ mergePets: false }), true).map((row) => [row.actor, row.total])).toEqual([
    [0, 2550],
    [1, 2000],
    [2, 500],
  ])
})

it('counts from the start of a span up to its end, without it', () => {
  const rows = damageRows(damage, scope({ span: { from: 1000, to: 3000 }, lengthMs: 2000 }), true)
  expect(rows.map((row) => [row.actor, row.total])).toEqual([
    [0, 1500],
    [1, 2000],
  ])
})

const taken = replayData({
  actors,
  entries: [
    { t: 0, actor: 0, other: 3, skill: 'action:600', field: 'taken', amount: 1000 },
    { t: 1000, actor: 1, other: 3, skill: 'action:600', field: 'taken', amount: 500 },
    { t: 2000, actor: 1, skill: 'status:7', field: 'taken', amount: 100 },
    { t: 2000, actor: 1, skill: 'status:7', field: 'taken', amount: -100 },
    { t: 2000, actor: 1, skill: 'status:7', field: 'taken', amount: 120 },
  ],
  events: [{ kind: 'death', t: 3000, actor: 1, killingBlow: null, recentHits: [], maxHp: null, statuses: [] }],
})

it('sums the damage the chosen members took, by member and by enemy skill', () => {
  expect(takenByActor(taken, scope())).toEqual([
    {
      actor: 0,
      perSecond: 100,
      total: 1000,
      deaths: 0,
      skills: [{ skill: 'action:600', total: 1000, hits: 1 }],
    },
    {
      actor: 1,
      perSecond: 62,
      total: 620,
      deaths: 1,
      skills: [
        { skill: 'action:600', total: 500, hits: 1 },
        { skill: 'status:7', total: 120, hits: 1 },
      ],
    },
  ])
  expect(takenBySkill(taken, scope({ chosen: new Set([1]) }))).toEqual([
    { skill: 'action:600', total: 500, share: 500 / 620, hits: 1, targets: [1] },
    { skill: 'status:7', total: 120, share: 120 / 620, hits: 1, targets: [1] },
  ])
})

const heals = replayData({
  actors,
  entries: [
    { t: 0, actor: 1, other: 0, skill: 'action:120', field: 'healing', amount: 1000 },
    { t: 0, actor: 1, skill: 'action:120', field: 'overheal', amount: 250 },
    { t: 1000, actor: 1, other: 1, skill: 'action:121', field: 'healing', amount: 500 },
    { t: 1000, actor: 2, other: 0, skill: 'action:122', field: 'healing', amount: 300 },
  ],
})

it('sums healing by member, by skill and by target', () => {
  expect(healByActor(heals, scope(), new Set())).toEqual([
    {
      actor: 1,
      hps: 150,
      total: 1500,
      overhealRate: 250 / 1500,
      skills: [
        { skill: 'action:120', hps: 100, total: 1000, overhealRate: 0.25 },
        { skill: 'action:121', hps: 50, total: 500, overhealRate: 0 },
      ],
    },
    { actor: 0, hps: 30, total: 300, overhealRate: 0, skills: [expect.objectContaining({ skill: 'action:122' })] },
  ])
  expect(healByActor(heals, scope(), new Set([1]))[0].overhealRate).toBeNull()
  expect(healBySkill(heals, scope())).toEqual([
    { skill: 'action:120', total: 1000, share: 1000 / 1800, hits: 1, users: [1] },
    { skill: 'action:121', total: 500, share: 500 / 1800, hits: 1, users: [1] },
    { skill: 'action:122', total: 300, share: 300 / 1800, hits: 1, users: [0] },
  ])
  expect(healByTarget(heals, scope())).toEqual([
    { target: 0, total: 1300 },
    { target: 1, total: 500 },
  ])
})
