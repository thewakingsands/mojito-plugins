import { describe, expect, it } from 'vitest'
import type { PotencySample, ReplayData, ReplayStatus } from '../../view-model.js'
import { enemy, member, replayData } from './data.test-helper.js'
import { analyzePotency } from './potency.js'

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
    ],
    ...patch,
  })
}

// The algorithm is tested in the combat model; these cases check the names the reasons get.
describe('analyzePotency', () => {
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
