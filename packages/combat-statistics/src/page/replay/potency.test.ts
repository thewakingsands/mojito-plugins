import { describe, expect, it } from 'vitest'
import type { PotencySample, ReplayData, ReplayStatus } from '../../view-model.js'
import { enemy, member, replayData } from './data.test-helper.js'
import { analyzePotency } from './potency.js'

const SPACING = 2500
type Extra = Partial<Pick<PotencySample, 'multiplier' | 'factors' | 'target' | 'actor'>>
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
      { statusId: 215, name: '伤害降低', category: 'debuff' },
      { statusId: 1001, name: '团辅', category: 'buff' },
      { statusId: 1002, name: '自身增益', category: 'buff' },
      { statusId: 1003, name: '易伤', category: 'debuff' },
      { statusId: 1005, name: '别的状态', category: 'debuff' },
    ],
    ...patch,
  })
}
const shape = (region: { from: number; to: number; deviation: number; count: number }) => ({
  from: region.from,
  to: region.to,
  deviation: Number(region.deviation.toFixed(6)),
  count: region.count,
})

describe('analyzePotency', () => {
  it('gives nothing for a member without samples', () => {
    expect(analyzePotency(data(fight([])), 1)).toBeNull()
  })

  it('has no window value with fewer than three samples within five seconds, and no region then', () => {
    // A sample every six seconds is alone in its window
    const samples = Array.from({ length: 15 }, (_, index) => sample(index * 6000, index % 2 ? 80 : 40))
    const analysis = analyzePotency(data(samples), 0)!
    expect(analysis.points.every((point) => point.w === null)).toBe(true)
    expect(analysis.points[1]).toEqual({ t: 6000, r: 80, w: null })
    expect(analysis.regions).toEqual([])
  })

  it('leaves the samples with known multipliers out of the baseline', () => {
    const analysis = analyzePotency(data(fight(series(20_000, 50_000, 56, { multiplier: 1.12 }))), 0)!
    expect(analysis.baseline).toBe(50)
  })

  it('takes every sample for the baseline when fewer than five have no known multiplier', () => {
    const samples = [...series(0, 10_000, 50), ...series(10_000, 30_000, 60, { multiplier: 1.2 })]
    expect(analyzePotency(data(samples), 0)!.baseline).toBe(60)
  })

  it('takes the median again without the samples whose window strays from the first one', () => {
    // 48 to 52 around 50, then 60 for a while: the first median is 52, the second 50
    const samples = [...series(0, 50_000, (index) => 48 + (index % 5)), ...series(50_000, 87_500, 60)]
    expect(analyzePotency(data(samples), 0)!.baseline).toBe(50)
  })

  it('splits regions by their direction', () => {
    const analysis = analyzePotency(data(fight([...series(20_000, 30_000, 60), ...series(30_000, 40_000, 40)])), 0)!
    expect(analysis.baseline).toBe(50)
    expect(analysis.regions.map(shape)).toEqual([
      { from: 18_750, to: 28_750, deviation: 0.2, count: 4 },
      { from: 28_750, to: 38_750, deviation: -0.2, count: 4 },
    ])
    expect(analysis.regions[0].median).toBe(60)
  })

  it('splits regions over a pause of more than fifteen seconds, and keeps them within the fight', () => {
    const samples = fight(
      [
        ...series(0, 10_000, 60),
        ...series(35_000, 45_000, 60),
        ...series(65_000, 75_000, 60),
        ...series(130_000, 138_000, 60),
      ],
      138_000,
    ).filter((item) => item.t < 45_000 || item.t >= 65_000)
    const analysis = analyzePotency(data(samples, { fight: { visitId: 'v', fightId: 'f', durationMs: 138_000 } }), 0)!
    expect(analysis.regions.map(shape)).toEqual([
      { from: 0, to: 8750, deviation: 0.2, count: 4 },
      { from: 33_750, to: 43_750, deviation: 0.2, count: 4 },
      { from: 63_750, to: 73_750, deviation: 0.2, count: 4 },
      { from: 128_750, to: 138_000, deviation: 0.2, count: 4 },
    ])
  })

  describe('reasons', () => {
    it('explains a region by the multipliers of others, of the member, of the target and below one', () => {
      const raid = { statusId: 1001, source: 1, holder: 'caster' as const, value: 1.1 }
      const own = { statusId: 1002, source: 0, holder: 'caster' as const, value: 1.05 }
      const target = { statusId: 1003, source: 1, holder: 'target' as const, value: 1.05 }
      const lower = { statusId: 1004, source: 2, holder: 'caster' as const, value: 0.9 }
      const samples = fight([
        ...series(20_000, 30_000, 55, { multiplier: 1.1, factors: [raid] }),
        ...series(40_000, 50_000, 60, { multiplier: 1.1025, factors: [own, target] }),
        ...series(60_000, 70_000, 45),
        ...series(80_000, 90_000, 45, { multiplier: 0.9, factors: [lower] }),
      ])
      const statuses = [
        status(0, 1002, 0, 100_000),
        status(0, 215, 59_000, 70_000),
        status(2, 1003, 39_000, 51_000),
        status(2, 1005, 0, 10_000),
      ]
      const analysis = analyzePotency(data(samples, { statuses }), 0)!
      expect(analysis.baseline).toBe(50)
      expect(analysis.regions.map((region) => [region.known, region.unknown])).toEqual([
        [[{ kind: 'raid', names: ['团辅'] }], null],
        [
          [
            { kind: 'self', names: ['自身增益'] },
            { kind: 'target', names: ['易伤'] },
          ],
          // 60 ÷ 1.1025 is still 8.8% above the baseline
          { kind: 'partly', self: ['自身增益'], boss: ['易伤'] },
        ],
        [[{ kind: 'down', names: ['伤害降低'] }], null],
        [[{ kind: 'down', names: ['状态 #1004'] }], null],
      ])
    })

    it('lists the statuses on the member and on the boss when nothing known explains a region', () => {
      const samples = fight([
        ...series(20_000, 25_000, 60),
        ...series(25_000, 30_000, 60, { target: -1 }),
        ...series(50_000, 60_000, 60, { target: -1 }),
      ])
      const statuses = [
        status(0, 1002, 0, 100_000),
        // Damage Down counts only for a region below the baseline
        status(0, 215, 21_000, 23_000),
        status(2, 1003, 10_000, 30_000),
        status(2, 9999, 25_000, 26_000),
        status(2, 1005, 40_000, 45_000),
      ]
      const analysis = analyzePotency(data(samples, { statuses }), 0)!
      expect(analysis.regions.map((region) => [region.known, region.unknown])).toEqual([
        [[], { kind: 'unknown', self: ['自身增益', '伤害降低'], boss: ['易伤', '状态 #9999'] }],
        // No target that is an actor: no boss
        [[], { kind: 'unknown', self: ['自身增益'], boss: null }],
      ])
    })
  })
})
