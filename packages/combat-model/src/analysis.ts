import type { PotencySample } from './output.js'

/** How far the damage per potency may stray from the baseline before it counts */
export const POTENCY_THRESHOLD = 0.05
/** The samples on each side of a sample whose median is its window value */
export const WINDOW_MS = 5_000
/** A point with fewer samples within WINDOW_MS judges no region, nor takes part in the second pass of the baseline */
export const MIN_WINDOW_SAMPLES = 3
/** Fewer samples without known multipliers than this, and the baseline takes all samples */
export const MIN_BASELINE_SAMPLES = 5
/** A longer pause between samples breaks the curve and ends a region */
export const GAP_MS = 15_000
export const REGION_PAD_MS = 1_250
/** The fixed bonus of a direct hit */
export const DIRECT_MULTIPLIER = 1.25
/** The samples that are neither critical nor direct, and those only critical, each that the critical bonus needs */
export const MIN_CRITICAL_SAMPLES = 10

/** The Damage Down statuses, which lower the damage the holder deals */
export const damageDownStatuses: ReadonlySet<number> = new Set([
  62, 215, 628, 696, 1016, 1090, 2092, 2404, 2522, 2911, 3166, 3304, 3964, 4370, 4371, 4514, 4874, 5451,
])

/**
 * A potency sample of the member, t milliseconds after the fight started. The actor ids may be any ids the caller
 * uses, as long as the context uses the same ones.
 */
export type AnalysisSample = Pick<
  PotencySample,
  'targetId' | 'actionId' | 'amount' | 'potency' | 'multiplier' | 'factors' | 'critical' | 'direct'
> & { t: number }

export interface AnalysisContext {
  /** The member whose samples these are */
  actor: number
  durationMs: number
  /** The statuses of the fight, from and to in milliseconds after it started */
  statuses: readonly { actor: number; statusId: number; from: number; to: number }[]
}

export interface PotencyPoint {
  t: number
  /** amount ÷ potency, with the critical and direct hit bonuses taken out */
  r: number
  critical: boolean
  direct: boolean
  /** Median r of the samples within WINDOW_MS, the sample itself included */
  w: number
  /** The samples within WINDOW_MS, the sample itself included; below MIN_WINDOW_SAMPLES the point judges no region */
  n: number
}
export type ReasonKind = 'raid' | 'self' | 'target' | 'down'
export interface PotencyRegion {
  from: number
  to: number
  /** Median r of the region ÷ baseline − 1 */
  deviation: number
  /** Median r of the region */
  median: number
  count: number
  /** In the order raid, self, target, down; only groups that have statuses. Status 0 is a modifier of the gauge. */
  known: { kind: ReasonKind; statusIds: number[] }[]
  /**
   * 'partly': known reasons and an unknown remainder; 'unknown': no known reason; null: fully explained. self and boss
   * are the statuses on the member and on the target most of the samples hit, null without a target.
   */
  unknown: { kind: 'partly' | 'unknown'; self: number[]; boss: number[] | null } | null
}
export interface PotencyAnalysis {
  baseline: number
  /** Every sample of the member in time order, without the critical ones when the critical bonus is not known */
  points: PotencyPoint[]
  regions: PotencyRegion[]
  /** The critical bonus measured in the fight; null with too few samples */
  critical: number | null
  /** The critical samples left out because the critical bonus is not known */
  droppedCritical: number
}

const REASON_ORDER: ReasonKind[] = ['raid', 'self', 'target', 'down']
/** Multipliers this close to 1 count as none */
const NO_MULTIPLIER = 0.001

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
const deviates = (value: number, baseline: number) => Math.abs(value / baseline - 1) > POTENCY_THRESHOLD
const judged = (point: PotencyPoint) => point.n >= MIN_WINDOW_SAMPLES

/**
 * The critical bonus of the member in the fight: the median damage per potency of the hits that are only critical over
 * that of the hits that are neither. Both are taken without the known multipliers, as the raid buffs that raise the
 * critical rate gather the critical hits where the damage is high.
 * @returns null with fewer than MIN_CRITICAL_SAMPLES of either
 */
function criticalBonusOf(samples: readonly AnalysisSample[]): number | null {
  const value = (sample: AnalysisSample) => sample.amount / sample.potency / sample.multiplier
  const normal = samples.filter((sample) => !sample.critical && !sample.direct).map(value)
  const critical = samples.filter((sample) => sample.critical && !sample.direct).map(value)
  if (normal.length < MIN_CRITICAL_SAMPLES || critical.length < MIN_CRITICAL_SAMPLES) return null
  return median(critical) / median(normal)
}

/**
 * The baseline damage per potency of a member in a fight, and the regions where it strays from it with their reasons
 * @param samples The samples of the member in time order
 * @returns null without samples
 */
export function analyzePotency(samples: readonly AnalysisSample[], context: AnalysisContext): PotencyAnalysis | null {
  const critical = criticalBonusOf(samples)
  const kept = critical === null ? samples.filter((sample) => !sample.critical) : samples
  if (!kept.length) return null
  const points = kept.map((sample): PotencyPoint => {
    const r =
      sample.amount /
      sample.potency /
      (sample.direct ? DIRECT_MULTIPLIER : 1) /
      (sample.critical ? (critical as number) : 1)
    return { t: sample.t, r, critical: sample.critical, direct: sample.direct, w: r, n: 1 }
  })
  for (const point of points) {
    const near = points.filter((other) => Math.abs(other.t - point.t) <= WINDOW_MS).map((other) => other.r)
    point.w = median(near)
    point.n = near.length
  }
  const baseline = baselineOf(kept, points)

  const groups: number[][] = []
  let current: number[] | null = null
  let direction = 0
  for (let i = 0; i < points.length; i++) {
    if (!judged(points[i])) continue
    const { w, t } = points[i]
    if (!deviates(w, baseline)) {
      current = null
      continue
    }
    const sign = Math.sign(w - baseline)
    if (current && sign === direction && t - points[current.at(-1)!].t <= GAP_MS) current.push(i)
    else {
      current = [i]
      direction = sign
      groups.push(current)
    }
  }
  const regions = groups.map((group) => regionOf(context, group, kept, points, baseline))
  return { baseline, points, regions, critical, droppedCritical: samples.length - kept.length }
}

/** The median r of the samples without known multipliers, again without those whose window strays from it */
function baselineOf(samples: readonly AnalysisSample[], points: readonly PotencyPoint[]): number {
  let candidates = points.filter((_, i) => Math.abs(samples[i].multiplier - 1) < NO_MULTIPLIER)
  if (candidates.length < MIN_BASELINE_SAMPLES) candidates = [...points]
  const first = median(candidates.map((point) => point.r))
  const kept = candidates.filter((point) => !judged(point) || !deviates(point.w, first))
  return kept.length ? median(kept.map((point) => point.r)) : first
}

function regionOf(
  context: AnalysisContext,
  group: readonly number[],
  samples: readonly AnalysisSample[],
  points: readonly PotencyPoint[],
  baseline: number,
): PotencyRegion {
  const { actor } = context
  const from = Math.max(0, points[group[0]].t - REGION_PAD_MS)
  const to = Math.min(context.durationMs, points[group.at(-1)!].t + REGION_PAD_MS)
  const regionMedian = median(group.map((i) => points[i].r))
  const deviation = regionMedian / baseline - 1
  const down = points[group[0]].w < baseline
  const statusesOf = (holder: number) =>
    context.statuses.filter((status) => status.actor === holder && status.from < to && status.to > from)

  const groups = new Map<ReasonKind, Set<number>>()
  const add = (kind: ReasonKind, statusId: number) => {
    let ids = groups.get(kind)
    if (!ids) {
      ids = new Set()
      groups.set(kind, ids)
    }
    ids.add(statusId)
  }
  const seen = new Set<string>()
  for (const i of group)
    for (const factor of samples[i].factors) {
      if (Math.abs(factor.value - 1) < NO_MULTIPLIER) continue
      const key = `${factor.statusId}:${factor.sourceId}:${factor.holder}`
      if (seen.has(key)) continue
      seen.add(key)
      if (factor.value < 1) add('down', factor.statusId)
      else if (factor.holder === 'target') add('target', factor.statusId)
      else add(factor.sourceId === actor ? 'self' : 'raid', factor.statusId)
    }
  let damageDown = false
  if (down)
    for (const status of statusesOf(actor))
      if (damageDownStatuses.has(status.statusId)) {
        damageDown = true
        add('down', status.statusId)
      }
  const known = REASON_ORDER.flatMap((kind) => {
    const ids = groups.get(kind)
    return ids?.size ? [{ kind, statusIds: [...ids] }] : []
  })

  const residual = median(group.map((i) => points[i].r / samples[i].multiplier)) / baseline - 1
  const explained =
    known.length > 0 && (Math.abs(residual) <= POTENCY_THRESHOLD || (down && (damageDown || groups.has('down'))))
  let unknown: PotencyRegion['unknown'] = null
  if (!explained) {
    const ids = (holder: number) => [...new Set(statusesOf(holder).map((status) => status.statusId))]
    const targets = new Map<number, number>()
    for (const i of group) {
      const target = samples[i].targetId
      if (target !== null) targets.set(target, (targets.get(target) ?? 0) + 1)
    }
    let boss: number | null = null
    for (const [target, count] of targets) if (boss === null || count > targets.get(boss)!) boss = target
    unknown = {
      kind: known.length ? 'partly' : 'unknown',
      self: ids(actor),
      boss: boss === null ? null : ids(boss),
    }
  }
  return { from, to, deviation, median: regionMedian, count: group.length, known, unknown }
}
