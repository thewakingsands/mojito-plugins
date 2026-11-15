import type { AttackType } from './defs.js'

/** Actor and target identifiers stay local to the collector. */
export interface TelemetrySample {
  casterId: number
  targetId: number
  classJob: number
  level: number
  actionId: number
  damageType: AttackType
  unknownStatuses: { id: number; param: number }[]
  critical: { hit: boolean; addedRate: number } | null
  direct: { hit: boolean; addedRate: number } | null
  normal: { value: number; potency: number } | null
}
export interface RateStats {
  hits: number
  successes: number
  addedRate: number
}
export interface DamageStats {
  count: number
  sum: number
  sumSquares: number
}
export interface TelemetryProfile {
  classJob: number
  level: number
  critical: RateStats
  direct: RateStats
}
export interface TelemetryObservation {
  profile: number
  unknownStatuses: { id: number; param: number }[]
  actionId: number
  damageType: AttackType
  normal: DamageStats & { potencySum: number }
  baseline: DamageStats
  critical: RateStats
  direct: RateStats
}
export interface TelemetryPayloadBody {
  profiles: TelemetryProfile[]
  observations: TelemetryObservation[]
}
const damageStats = (): DamageStats => ({ count: 0, sum: 0, sumSquares: 0 })
const rateStats = (): RateStats => ({ hits: 0, successes: 0, addedRate: 0 })
function addRate(stats: RateStats, sample: TelemetrySample['critical']): void {
  if (!sample) return
  stats.hits++
  stats.successes += Number(sample.hit)
  stats.addedRate += sample.addedRate
}
interface Group {
  sample: TelemetrySample
  base: string
  normal: TelemetryObservation['normal']
  critical: RateStats
  direct: RateStats
}
interface Profile {
  job: number
  level: number
  critical: RateStats
  direct: RateStats
}
/** One encounter, finalized once. Clean and candidate groups share the limit. */
export class TelemetryCollector {
  private groups = new Map<string, Group>()
  private profiles = new Map<number, Profile>()
  private excluded = new Set<number>()
  private closed = false

  invalidate(): void {
    this.closed = true
    this.groups.clear()
    this.profiles.clear()
    this.excluded.clear()
  }

  profile(actor: number, job: number, level: number): void {
    if (this.closed || this.excluded.has(actor)) return
    const previous = this.profiles.get(actor)
    if (previous && (previous.job !== job || previous.level !== level)) {
      for (const [key, group] of this.groups) if (group.sample.casterId === actor) this.groups.delete(key)
      this.profiles.delete(actor)
      this.excluded.add(actor)
    } else if (!previous) this.profiles.set(actor, { job, level, critical: rateStats(), direct: rateStats() })
  }

  add(sample: TelemetrySample): void {
    if (this.closed) return
    this.profile(sample.casterId, sample.classJob, sample.level)
    if (this.excluded.has(sample.casterId)) return
    const base = [
      sample.casterId,
      sample.classJob,
      sample.level,
      sample.actionId,
      sample.damageType,
      sample.targetId,
    ].join(':')
    const key = `${base}/${sample.unknownStatuses.map(({ id, param }) => `${id}:${param}`).join(',')}`
    let group = this.groups.get(key)
    if (!group) {
      if (this.groups.size >= 4096) {
        this.invalidate()
        return
      }
      group = {
        sample: { ...sample, unknownStatuses: sample.unknownStatuses.map((status) => ({ ...status })) },
        base,
        normal: { ...damageStats(), potencySum: 0 },
        critical: rateStats(),
        direct: rateStats(),
      }
      this.groups.set(key, group)
    }
    if (sample.normal) {
      group.normal.count++
      group.normal.sum += sample.normal.value
      group.normal.sumSquares += sample.normal.value ** 2
      group.normal.potencySum += sample.normal.potency
    }
    addRate(group.critical, sample.critical)
    addRate(group.direct, sample.direct)
    const profile = this.profiles.get(sample.casterId)!
    if (!sample.unknownStatuses.length) {
      addRate(profile.critical, sample.critical)
      addRate(profile.direct, sample.direct)
    }
    for (const stats of [group.normal, group.critical, group.direct, profile.critical, profile.direct]) {
      if (Object.values(stats).some((value) => !Number.isFinite(value) || value < 0)) this.invalidate()
      const count = 'count' in stats ? stats.count : stats.hits
      if (!Number.isSafeInteger(count)) this.invalidate()
    }
  }

  finish(): TelemetryPayloadBody {
    const body: TelemetryPayloadBody = { profiles: [], observations: [] }
    if (this.closed) return body
    const candidates = [...this.groups.entries()]
      .filter(
        ([, group]) => group.sample.unknownStatuses.length && (group.critical.hits >= 5 || group.normal.count >= 5),
      )
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    const actors = new Set(candidates.map(([, group]) => group.sample.casterId))
    const indexes = new Map<number, number>()
    for (const [actor, profile] of this.profiles) {
      if (!actors.has(actor)) continue
      indexes.set(actor, body.profiles.length)
      body.profiles.push({
        classJob: profile.job,
        level: profile.level,
        critical: profile.critical,
        direct: profile.direct,
      })
    }
    for (const [, group] of candidates) {
      const baseline = this.groups.get(`${group.base}/`)?.normal ?? damageStats()
      body.observations.push({
        profile: indexes.get(group.sample.casterId)!,
        unknownStatuses: group.sample.unknownStatuses,
        actionId: group.sample.actionId,
        damageType: group.sample.damageType,
        normal: group.normal,
        baseline: { count: baseline.count, sum: baseline.sum, sumSquares: baseline.sumSquares },
        critical: group.critical,
        direct: group.direct,
      })
    }
    this.invalidate()
    return body
  }
}

/** Drop the least sampled observations; ties discard the later local group first. */
export function fitPayload(
  body: TelemetryPayloadBody,
  maxObservations: number,
  maxBytes: number,
  serialize: (body: TelemetryPayloadBody) => string,
): TelemetryPayloadBody | null {
  const removal = body.observations
    .map((observation, index) => ({ index, score: observation.critical.hits + observation.normal.count }))
    .sort((a, b) => a.score - b.score || b.index - a.index)
  const removed = new Set<number>()
  const compact = (): TelemetryPayloadBody => {
    const observations = body.observations.filter((_, index) => !removed.has(index))
    const used = new Set(observations.map((observation) => observation.profile))
    const indexes = new Map<number, number>()
    const profiles = body.profiles.filter((_, index) => {
      if (!used.has(index)) return false
      indexes.set(index, indexes.size)
      return true
    })
    return {
      profiles,
      observations: observations.map((observation) => ({ ...observation, profile: indexes.get(observation.profile)! })),
    }
  }
  for (const item of removal.slice(0, Math.max(0, removal.length - maxObservations))) removed.add(item.index)
  let result = compact()
  while (result.observations.length) {
    if (result.profiles.length <= 256 && new TextEncoder().encode(serialize(result)).byteLength <= maxBytes)
      return result
    removed.add(removal[removed.size].index)
    result = compact()
  }
  return null
}
