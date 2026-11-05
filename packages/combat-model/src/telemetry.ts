import type { AttackType } from './defs.js'

/** Local only. Actor and target identifiers never enter an observation. */
export interface TelemetrySample {
  casterId: number
  targetId: number
  classJob: number
  level: number
  actionId: number
  damageType: AttackType
  correctedDamagePerPotency: number
  unknownStatuses: { id: number; param: number }[]
}
export interface Observation {
  unknownStatusIds: number[]
  unknownStatuses: { id: number; param: number }[]
  classJob: number
  level: number
  actionId: number
  damageType: AttackType
  sampleCount: number
  baselineSampleCount: number
  correctedDamagePerPotency: number
  baselineDamagePerPotency: number
}
export const deviates = (corrected: number, baseline: number): boolean => {
  const delta = 10 * Math.abs(corrected - baseline)
  return (
    Number.isFinite(corrected) &&
    corrected >= 0 &&
    Number.isFinite(baseline) &&
    baseline > 0 &&
    Number.isFinite(delta) &&
    delta > baseline
  )
}
interface Group {
  sample: TelemetrySample
  base: string
  count: number
  sum: number
}
/** One encounter, finalized once. Limits apply to baseline and candidate groups together. */
export class TelemetryCollector {
  private groups = new Map<string, Group>()
  private profiles = new Map<number, string>()
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
    const profile = `${job}:${level}`
    const previous = this.profiles.get(actor)
    if (previous !== undefined && previous !== profile) {
      for (const [key, group] of this.groups) if (group.sample.casterId === actor) this.groups.delete(key)
      this.excluded.add(actor)
    } else this.profiles.set(actor, profile)
  }

  add(sample: TelemetrySample): void {
    if (this.closed) return
    this.profile(sample.casterId, sample.classJob, sample.level)
    if (this.excluded.has(sample.casterId)) return
    const base = `${sample.casterId}:${sample.classJob}:${sample.level}:${sample.actionId}:${sample.damageType}:${sample.targetId}`
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
        count: 0,
        sum: 0,
      }
      this.groups.set(key, group)
    }
    group.count++
    group.sum += sample.correctedDamagePerPotency
    if (!Number.isFinite(group.sum) || !Number.isSafeInteger(group.count)) this.invalidate()
  }

  finish(): Observation[] {
    if (this.closed) return []
    const observations: Observation[] = []
    for (const group of this.groups.values()) {
      const sample = group.sample
      if (!sample.unknownStatuses.length || group.count < 5) continue
      const baseline = this.groups.get(`${group.base}/`)
      if (!baseline || baseline.count < 5) continue
      const correctedDamagePerPotency = group.sum / group.count
      const baselineDamagePerPotency = baseline.sum / baseline.count
      if (!deviates(correctedDamagePerPotency, baselineDamagePerPotency)) continue
      observations.push({
        unknownStatuses: sample.unknownStatuses,
        unknownStatusIds: [...new Set(sample.unknownStatuses.map(({ id }) => id))],
        classJob: sample.classJob,
        level: sample.level,
        actionId: sample.actionId,
        damageType: sample.damageType,
        sampleCount: group.count,
        baselineSampleCount: baseline.count,
        correctedDamagePerPotency,
        baselineDamagePerPotency,
      })
      if (observations.length > 256) {
        this.invalidate()
        return []
      }
    }
    this.invalidate()
    return observations
  }
}
