import { describe, expect, it } from 'vitest'
import type { PotencySample, ReplayData, ReplayStatus } from '../../view-model.js'
import { enemy, member, replayData } from './data.test-helper.js'
import { analyzePotency, statusesAt } from './potency.js'

const SPACING = 2500
type Extra = Partial<Pick<PotencySample, 'multiplier' | 'factors' | 'target' | 'actor' | 'critical' | 'direct'>>
/** A sample of member 0 on the boss 2 with a potency of 200 */
const sample = (t: number, r: number, extra: Extra = {}): PotencySample => ({
  t,
  actor: 0,
  target: 2,
  actionId: 9,
  amount: r * 200,
  potency: 200,
  multiplier: 1,
  factors: [],
  critical: false,
  direct: false,
  ...extra,
})
/** Samples every SPACING from `from`, before `to` */
const series = (from: number, to: number, r: number | ((index: number) => number), extra: Extra = {}) =>
  Array.from({ length: Math.ceil((to - from) / SPACING) }, (_, index) =>
    sample(from + index * SPACING, typeof r === 'number' ? r : r(index), extra),
  )
/** r 50 over the fight, with the parts given in their place */
function fight(parts: PotencySample[], durationMs = 100_000) {
  const times = new Set(parts.map((part) => part.t))
  return [...series(0, durationMs, 50).filter((item) => !times.has(item.t)), ...parts].sort((a, b) => a.t - b.t)
}
const status = (actor: number, statusId: number, from: number, to: number): ReplayStatus => ({
  actor,
  statusId,
  source: null,
  from,
  to,
  stacks: null,
})
/** Members 0 and 1, the boss 2 */
function data(potency: PotencySample[], patch: Partial<Pick<ReplayData, 'fight' | 'statuses'>> = {}) {
  return replayData({
    fight: { visitId: 'v', fightId: 'f', durationMs: 100_000 },
    actors: [member(0, 19), member(1, 24), enemy(2, true)],
    potency,
    statusInfo: [
      { statusId: 215, name: '伤害降低', category: 'debuff', raidBuff: false },
      { statusId: 1001, name: '团辅', category: 'buff', raidBuff: true },
      { statusId: 1002, name: '自身增益', category: 'buff', raidBuff: false },
      { statusId: 1003, name: '易伤', category: 'debuff', raidBuff: false },
      { statusId: 1005, name: '别的状态', category: 'debuff', raidBuff: false },
      { statusId: 1006, name: '同名', category: 'buff', raidBuff: false },
      { statusId: 1007, name: '同名', category: 'buff', raidBuff: false },
    ],
    ...patch,
  })
}

// The algorithm is tested in the combat model
describe('analyzePotency', () => {
  it('takes the samples of the member, a target that is no actor as none', () => {
    const samples = fight([
      ...series(20_000, 30_000, 60),
      ...series(50_000, 60_000, 60, { target: -1 }),
      ...series(0, 100_000, 80, { actor: 1 }).map((item) => ({ ...item, t: item.t + 1 })),
    ])
    const analysis = analyzePotency(data(samples), 0)!
    expect(analysis.baseline).toBe(50)
    expect(analysis.points).toHaveLength(40)
    expect(analysis.points.filter((point) => point.targetId === null).map((point) => point.t)).toEqual([
      50_000, 52_500, 55_000, 57_500,
    ])
    expect(analysis.points.every((point) => point.targetId === null || point.targetId === 2)).toBe(true)
    expect(
      analysis.regions.map(({ from, to, deviation, count }) => [from, to, Number(deviation.toFixed(6)), count]),
    ).toEqual([
      [18_750, 28_750, 0.2, 4],
      [48_750, 58_750, 0.2, 4],
    ])
  })

  it('gives nothing for a member without samples', () => {
    expect(analyzePotency(data([]), 1)).toBeNull()
  })
})

describe('statusesAt', () => {
  const at = (statuses: ReplayStatus[], actor: number, t: number) =>
    statusesAt(data([], { statuses }), actor, t).map((item) => [item.statusId, item.name])

  it('takes a status from its start, until its end', () => {
    const statuses = [status(0, 1002, 10_000, 20_000)]
    expect(at(statuses, 0, 10_000)).toEqual([[1002, '自身增益']])
    expect(at(statuses, 0, 19_999)).toEqual([[1002, '自身增益']])
    expect(at(statuses, 0, 20_000)).toEqual([])
    expect(at(statuses, 0, 9_999)).toEqual([])
  })

  it('takes only the statuses on the actor', () => {
    const statuses = [status(0, 1002, 0, 20_000), status(1, 1001, 0, 20_000), status(2, 1003, 0, 20_000)]
    expect(at(statuses, 0, 5_000)).toEqual([[1002, '自身增益']])
    expect(at(statuses, 2, 5_000)).toEqual([[1003, '易伤']])
  })

  it('orders the statuses by their start, and keeps the earliest of the same name', () => {
    const statuses = [
      status(0, 1005, 3_000, 20_000),
      status(0, 1007, 2_000, 20_000),
      status(0, 1006, 1_000, 20_000),
      status(0, 9999, 4_000, 20_000),
    ]
    expect(at(statuses, 0, 5_000)).toEqual([
      [1006, '同名'],
      [1005, '别的状态'],
      [9999, '状态 #9999'],
    ])
  })
})
