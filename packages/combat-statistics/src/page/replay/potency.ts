import { damageDownStatuses } from '../../replay/catalog.js'
import type { PotencySample, ReplayData } from '../../view-model.js'

/** How far the damage per potency may stray from the baseline before it counts */
export const POTENCY_THRESHOLD = 0.05
/** The samples on each side of a sample whose median is its window value */
export const WINDOW_MS = 5_000
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

export interface PotencyPoint {
  t: number
  /** amount ÷ potency, with the critical and direct hit bonuses taken out */
  r: number
  critical: boolean
  direct: boolean
  /** Median r of the samples within WINDOW_MS; null when fewer than MIN_WINDOW_SAMPLES */
  w: number | null
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
  /** In the order raid, self, target, down; only groups that have names */
  known: { kind: ReasonKind; names: string[] }[]
  /** 'partly': known reasons and an unknown remainder; 'unknown': no known reason; null: fully explained */
  unknown: { kind: 'partly' | 'unknown'; self: string[]; boss: string[] | null } | null
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

/**
 * The critical bonus of the member in the fight: the median damage per potency of the hits that are only critical over
 * that of the hits that are neither. Both are taken without the known multipliers, as the raid buffs that raise the
 * critical rate gather the critical hits where the damage is high.
 * @returns null with fewer than MIN_CRITICAL_SAMPLES of either
 */
function criticalBonusOf(samples: readonly PotencySample[]): number | null {
  const value = (sample: PotencySample) => sample.amount / sample.potency / sample.multiplier
  const normal = samples.filter((sample) => !sample.critical && !sample.direct).map(value)
  const critical = samples.filter((sample) => sample.critical && !sample.direct).map(value)
  if (normal.length < MIN_CRITICAL_SAMPLES || critical.length < MIN_CRITICAL_SAMPLES) return null
  return median(critical) / median(normal)
}

export function analyzePotency(data: ReplayData, actor: number): PotencyAnalysis | null {
  const all = data.potency.filter((sample) => sample.actor === actor)
  const critical = criticalBonusOf(all)
  const samples = critical === null ? all.filter((sample) => !sample.critical) : all
  if (!samples.length) return null
  const points = samples.map(
    (sample): PotencyPoint => ({
      t: sample.t,
      r:
        sample.amount /
        sample.potency /
        (sample.direct ? DIRECT_MULTIPLIER : 1) /
        (sample.critical ? (critical as number) : 1),
      critical: sample.critical,
      direct: sample.direct,
      w: null,
    }),
  )
  for (const point of points) {
    const near = points.filter((other) => Math.abs(other.t - point.t) <= WINDOW_MS).map((other) => other.r)
    point.w = near.length >= MIN_WINDOW_SAMPLES ? median(near) : null
  }
  const baseline = baselineOf(samples, points)

  const groups: number[][] = []
  let current: number[] | null = null
  let direction = 0
  for (let i = 0; i < points.length; i++) {
    const { w, t } = points[i]
    if (w === null) continue
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
  const regions = groups.map((group) => regionOf(data, actor, group, samples, points, baseline))
  return { baseline, points, regions, critical, droppedCritical: all.length - samples.length }
}

/** The median r of the samples without known multipliers, again without those whose window strays from it */
function baselineOf(samples: readonly PotencySample[], points: readonly PotencyPoint[]): number {
  let candidates = points.filter((_, i) => Math.abs(samples[i].multiplier - 1) < NO_MULTIPLIER)
  if (candidates.length < MIN_BASELINE_SAMPLES) candidates = [...points]
  const first = median(candidates.map((point) => point.r))
  const kept = candidates.filter((point) => point.w === null || !deviates(point.w, first))
  return kept.length ? median(kept.map((point) => point.r)) : first
}

function regionOf(
  data: ReplayData,
  actor: number,
  group: readonly number[],
  samples: readonly PotencySample[],
  points: readonly PotencyPoint[],
  baseline: number,
): PotencyRegion {
  const from = Math.max(0, points[group[0]].t - REGION_PAD_MS)
  const to = Math.min(data.fight.durationMs, points[group.at(-1)!].t + REGION_PAD_MS)
  const regionMedian = median(group.map((i) => points[i].r))
  const deviation = regionMedian / baseline - 1
  const down = points[group[0]].w! < baseline
  const nameOf = (statusId: number) =>
    data.statusInfo.find((info) => info.statusId === statusId)?.name ?? `状态 #${statusId}`
  const statusesOf = (holder: number) =>
    data.statuses.filter((status) => status.actor === holder && status.from < to && status.to > from)

  const groups = new Map<ReasonKind, Set<string>>()
  const add = (kind: ReasonKind, statusId: number) => {
    let names = groups.get(kind)
    if (!names) {
      names = new Set()
      groups.set(kind, names)
    }
    // A factor without a Status is a modifier of the gauge
    names.add(statusId === 0 ? '量谱' : nameOf(statusId))
  }
  const seen = new Set<string>()
  for (const i of group)
    for (const factor of samples[i].factors) {
      if (Math.abs(factor.value - 1) < NO_MULTIPLIER) continue
      const key = `${factor.statusId}:${factor.source}:${factor.holder}`
      if (seen.has(key)) continue
      seen.add(key)
      if (factor.value < 1) add('down', factor.statusId)
      else if (factor.holder === 'target') add('target', factor.statusId)
      else add(factor.source === actor ? 'self' : 'raid', factor.statusId)
    }
  let damageDown = false
  if (down)
    for (const status of statusesOf(actor))
      if (damageDownStatuses.has(status.statusId)) {
        damageDown = true
        add('down', status.statusId)
      }
  const known = REASON_ORDER.flatMap((kind) => {
    const names = groups.get(kind)
    return names?.size ? [{ kind, names: [...names] }] : []
  })

  const residual = median(group.map((i) => points[i].r / samples[i].multiplier)) / baseline - 1
  const explained =
    known.length > 0 && (Math.abs(residual) <= POTENCY_THRESHOLD || (down && (damageDown || groups.has('down'))))
  let unknown: PotencyRegion['unknown'] = null
  if (!explained) {
    const names = (holder: number) => [...new Set(statusesOf(holder).map((status) => nameOf(status.statusId)))]
    const targets = new Map<number, number>()
    for (const i of group) {
      const target = samples[i].target
      if (target >= 0) targets.set(target, (targets.get(target) ?? 0) + 1)
    }
    let boss: number | null = null
    for (const [target, count] of targets) if (boss === null || count > targets.get(boss)!) boss = target
    unknown = {
      kind: known.length ? 'partly' : 'unknown',
      self: names(actor),
      boss: boss === null ? null : names(boss),
    }
  }
  return { from, to, deviation, median: regionMedian, count: group.length, known, unknown }
}
