import { describe, expect, it } from 'vitest'
import { type AnalysisContext, type AnalysisSample, analyzePotency } from './analysis.js'

const SPACING = 2500
type Extra = Partial<Pick<AnalysisSample, 'multiplier' | 'factors' | 'targetId' | 'critical' | 'direct'>>
/** A sample of member 0 on the boss 2 with a potency of 200 */
const sample = (t: number, r: number, extra: Extra = {}): AnalysisSample => ({
  t,
  targetId: 2,
  actionId: 9,
  amount: r * 200,
  potency: 200,
  multiplier: 1,
  factors: [],
  critical: false,
  direct: false,
  ...extra,
})
/** A sample like `sample`, critical with a bonus of 1.6 and direct as the flags say */
const hit = (t: number, r: number, flags: { critical?: boolean; direct?: boolean }, extra: Extra = {}) => {
  const critical = flags.critical ?? false
  const direct = flags.direct ?? false
  const base = sample(t, r, { ...extra, critical, direct })
  return { ...base, amount: base.amount * (critical ? 1.6 : 1) * (direct ? 1.25 : 1) }
}
/** Samples every SPACING from `from`, before `to` */
const series = (from: number, to: number, r: number | ((index: number) => number), extra: Extra = {}) =>
  Array.from({ length: Math.ceil((to - from) / SPACING) }, (_, index) =>
    sample(from + index * SPACING, typeof r === 'number' ? r : r(index), extra),
  )
/** r 50 over the fight, with the parts given in their place */
function fight(parts: AnalysisSample[], durationMs = 100_000) {
  const times = new Set(parts.map((part) => part.t))
  return [...series(0, durationMs, 50).filter((item) => !times.has(item.t)), ...parts].sort((a, b) => a.t - b.t)
}
const status = (actor: number, statusId: number, from: number, to: number) => ({ actor, statusId, from, to })
/** The samples of member 0 in a fight of 100 seconds; member 1 and the boss 2 have none. 1001 is a raid buff. */
const analyze = (samples: AnalysisSample[], patch: Partial<AnalysisContext> = {}) =>
  analyzePotency(samples, { actor: 0, durationMs: 100_000, statuses: [], raidBuffStatuses: new Set([1001]), ...patch })
const shape = (region: { from: number; to: number; deviation: number; count: number }) => ({
  from: region.from,
  to: region.to,
  deviation: Number(region.deviation.toFixed(6)),
  count: region.count,
})

describe('analyzePotency', () => {
  it('gives nothing for a member without samples', () => {
    expect(analyze([], { actor: 1 })).toBeNull()
  })

  it('takes the window value of a sample alone in its window from itself, and judges no region by it', () => {
    // A sample every six seconds is alone in its window
    const samples = Array.from({ length: 15 }, (_, index) => sample(index * 6000, index % 2 ? 80 : 40))
    const analysis = analyze(samples)!
    expect(analysis.points.every((point) => point.w === point.r && point.n === 1)).toBe(true)
    expect(analysis.points[1]).toEqual({
      t: 6000,
      r: 80,
      w: 80,
      n: 1,
      critical: false,
      direct: false,
      targetId: 2,
    })
    expect(analysis.regions).toEqual([])
  })

  it('gives each point the target of its sample', () => {
    const samples = series(0, 20_000, 50).map((item, index) => ({ ...item, targetId: index % 3 ? index : null }))
    const analysis = analyze(samples)!
    expect(analysis.points.map((point) => point.targetId)).toEqual(samples.map((item) => item.targetId))
  })

  it('takes the median of two samples within five seconds', () => {
    const analysis = analyze([sample(0, 40), sample(4000, 60)])!
    expect(analysis.points.map((point) => [point.w, point.n])).toEqual([
      [50, 2],
      [50, 2],
    ])
  })

  it('keeps a region over a sample alone in its window', () => {
    const samples = [
      ...series(0, 20_000, 50),
      ...series(20_000, 30_000, 60),
      sample(33_750, 40),
      ...series(40_000, 50_000, 60),
      ...series(50_000, 100_000, 50),
    ].sort((a, b) => a.t - b.t)
    const analysis = analyze(samples)!
    expect(analysis.baseline).toBe(50)
    expect(analysis.points.find((point) => point.t === 33_750)).toMatchObject({ w: 40, n: 1 })
    expect(analysis.regions.map(shape)).toEqual([{ from: 18_750, to: 48_750, deviation: 0.2, count: 8 }])
  })

  it('leaves the samples with known multipliers out of the baseline', () => {
    const analysis = analyze(fight(series(20_000, 50_000, 56, { multiplier: 1.12 })))!
    expect(analysis.baseline).toBe(50)
  })

  it('takes every sample for the baseline when fewer than five have no known multiplier', () => {
    const samples = [...series(0, 10_000, 50), ...series(10_000, 30_000, 60, { multiplier: 1.2 })]
    expect(analyze(samples)!.baseline).toBe(60)
  })

  it('takes the median again without the samples whose window strays from the first one', () => {
    // 48 to 52 around 50, then 60 for a while: the first median is 52, the second 50
    const samples = [...series(0, 50_000, (index) => 48 + (index % 5)), ...series(50_000, 87_500, 60)]
    expect(analyze(samples)!.baseline).toBe(50)
  })

  it('splits regions by their direction', () => {
    const analysis = analyze(fight([...series(20_000, 30_000, 60), ...series(30_000, 40_000, 40)]))!
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
    const analysis = analyze(samples, { durationMs: 138_000 })!
    expect(analysis.regions.map(shape)).toEqual([
      { from: 0, to: 8750, deviation: 0.2, count: 4 },
      { from: 33_750, to: 43_750, deviation: 0.2, count: 4 },
      { from: 63_750, to: 73_750, deviation: 0.2, count: 4 },
      { from: 128_750, to: 138_000, deviation: 0.2, count: 4 },
    ])
  })

  describe('critical and direct hits', () => {
    it('measures the critical bonus and takes it and the direct bonus out', () => {
      const samples = series(0, 100_000, 50).map((item, index) =>
        hit(item.t, 50, { critical: index % 3 === 0, direct: index % 5 === 0 }),
      )
      const analysis = analyze(samples)!
      expect(analysis.critical).toBeCloseTo(1.6, 9)
      expect(analysis.droppedCritical).toBe(0)
      expect(analysis.points).toHaveLength(40)
      for (const point of analysis.points) expect(point.r).toBeCloseTo(50, 9)
      expect(analysis.points[0]).toMatchObject({ critical: true, direct: true })
      expect(analysis.baseline).toBeCloseTo(50, 9)
      expect(analysis.regions).toEqual([])
    })

    it('leaves the critical hits out when fewer than ten are only critical', () => {
      // 9 only critical, 1 critical and direct, 4 only direct
      const samples = series(0, 100_000, 50).map((item, index) =>
        hit(item.t, 50, { critical: index < 10, direct: index >= 9 && index < 14 }),
      )
      const analysis = analyze(samples)!
      expect(analysis.critical).toBeNull()
      expect(analysis.droppedCritical).toBe(10)
      expect(analysis.points).toHaveLength(30)
      expect(analysis.points.every((point) => !point.critical)).toBe(true)
      for (const point of analysis.points) expect(point.r).toBeCloseTo(50, 9)
    })

    it('keeps the target of each sample left when it leaves the critical hits out', () => {
      const samples = series(0, 100_000, 50).map((item, index) =>
        hit(item.t, 50, { critical: index % 5 === 1 }, { targetId: 100 + index }),
      )
      const analysis = analyze(samples)!
      expect(analysis.critical).toBeNull()
      const kept = samples.filter((item) => !item.critical)
      expect(analysis.points.map((point) => [point.t, point.targetId])).toEqual(
        kept.map((item) => [item.t, item.targetId]),
      )
    })

    it('leaves the critical hits out when fewer than ten are neither critical nor direct', () => {
      const samples = series(0, 100_000, 50).map((item, index) => hit(item.t, 50, { critical: index >= 9 }))
      const analysis = analyze(samples)!
      expect(analysis.critical).toBeNull()
      expect(analysis.droppedCritical).toBe(31)
      expect(analysis.points).toHaveLength(9)
    })

    it('does not take a higher bonus from the critical hits gathered under a raid buff', () => {
      const raid = { statusId: 1001, sourceId: 1, holder: 'caster' as const, value: 1.2 }
      const samples = series(0, 100_000, 50).map((item, index) => {
        const buffed = item.t >= 20_000 && item.t < 40_000
        return buffed
          ? hit(item.t, 60, { critical: true }, { multiplier: 1.2, factors: [raid] })
          : hit(item.t, 50, { critical: index % 10 === 0 })
      })
      expect(analyze(samples)!.critical).toBeCloseTo(1.6, 9)
    })

    it('gives nothing when every sample is a critical hit it cannot take', () => {
      expect(analyze([hit(0, 50, { critical: true })])).toBeNull()
    })
  })

  describe('reasons', () => {
    it('explains a region by the multipliers of others, of the member, of the target and below one', () => {
      const raid = { statusId: 1001, sourceId: 1, holder: 'caster' as const, value: 1.1 }
      const own = { statusId: 1002, sourceId: 0, holder: 'caster' as const, value: 1.05 }
      const target = { statusId: 1003, sourceId: 1, holder: 'target' as const, value: 1.05 }
      const lower = { statusId: 1004, sourceId: 2, holder: 'caster' as const, value: 0.9 }
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
      const analysis = analyze(samples, { statuses })!
      expect(analysis.baseline).toBe(50)
      expect(analysis.regions.map((region) => [region.known, region.unknown])).toEqual([
        [[{ kind: 'raid', statusIds: [1001] }], null],
        [
          [
            { kind: 'self', statusIds: [1002] },
            { kind: 'target', statusIds: [1003] },
          ],
          // 60 ÷ 1.1025 is still 8.8% above the baseline
          { kind: 'partly', self: [1002], boss: [1003] },
        ],
        [[{ kind: 'down', statusIds: [215] }], null],
        [[{ kind: 'down', statusIds: [1004] }], null],
      ])
    })

    it('takes a raid buff as raid only when another member gave it, on the member or on the target', () => {
      const onTarget = { statusId: 1001, sourceId: 1, holder: 'target' as const, value: 1.1 }
      const unmarked = { statusId: 1003, sourceId: 1, holder: 'caster' as const, value: 1.1 }
      const own = { statusId: 1001, sourceId: 0, holder: 'caster' as const, value: 1.1 }
      const samples = fight([
        ...series(20_000, 30_000, 55, { multiplier: 1.1, factors: [onTarget] }),
        ...series(45_000, 55_000, 55, { multiplier: 1.1, factors: [unmarked] }),
        ...series(70_000, 80_000, 55, { multiplier: 1.1, factors: [own] }),
      ])
      expect(analyze(samples)!.regions.map((region) => region.known)).toEqual([
        [{ kind: 'raid', statusIds: [1001] }],
        [{ kind: 'self', statusIds: [1003] }],
        [{ kind: 'self', statusIds: [1001] }],
      ])
    })

    it('lists the statuses on the member and on the boss when nothing known explains a region', () => {
      const samples = fight([
        ...series(20_000, 25_000, 60),
        ...series(25_000, 30_000, 60, { targetId: null }),
        ...series(50_000, 60_000, 60, { targetId: null }),
      ])
      const statuses = [
        status(0, 1002, 0, 100_000),
        // Damage Down counts only for a region below the baseline
        status(0, 215, 21_000, 23_000),
        status(2, 1003, 10_000, 30_000),
        status(2, 9999, 25_000, 26_000),
        status(2, 1005, 40_000, 45_000),
      ]
      const analysis = analyze(samples, { statuses })!
      expect(analysis.regions.map((region) => [region.known, region.unknown])).toEqual([
        [[], { kind: 'unknown', self: [1002, 215], boss: [1003, 9999] }],
        // No target that is an actor: no boss
        [[], { kind: 'unknown', self: [1002], boss: null }],
      ])
    })
  })
})
