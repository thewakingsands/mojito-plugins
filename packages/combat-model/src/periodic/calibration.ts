import { type PeriodicKind, type PotencyTable, potencyAt } from '../defs.js'

/** The samples of a caster the realtime estimate reads */
export const CALIBRATION_WINDOW = 300

interface Sample {
  action: number
  /** The amount per potency */
  value: number
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/**
 * The amount per potency of a hit: the amount over the potency at the level of the caster, the potency modifiers and
 * the multiplier.
 * @returns null when the level has no potency, as level 0 (unknown)
 */
export function samplePerPotency(
  amount: number,
  potency: PotencyTable,
  level: number,
  maxLevel: number,
  potencyFactor: number,
  multiplier: number,
): number | null {
  const base = potencyAt(potency, level, maxLevel)
  if (base === null) return null
  return amount / (base * potencyFactor * multiplier)
}

/** The calibration samples of every caster since the zone changed, damage and heal apart */
export class CalibrationSamples {
  private samples = new Map<string, Sample[]>()

  add(caster: number, kind: PeriodicKind, action: number, value: number): void {
    const key = `${caster}:${kind}`
    let list = this.samples.get(key)
    if (!list) {
      list = []
      this.samples.set(key, list)
    }
    list.push({ action, value })
  }

  count(caster: number, kind: PeriodicKind): number {
    return this.samples.get(`${caster}:${kind}`)?.length ?? 0
  }

  /**
   * ρ: the median of the medians of each calibration action, so that every action counts the same.
   * @param all Every sample since the zone changed, instead of the last CALIBRATION_WINDOW
   * @returns null without samples
   */
  perPotency(caster: number, kind: PeriodicKind, all = false): number | null {
    const list = this.samples.get(`${caster}:${kind}`)
    if (!list?.length) return null
    const used = all ? list : list.slice(-CALIBRATION_WINDOW)
    const byAction = new Map<number, number[]>()
    for (const { action, value } of used) {
      const values = byAction.get(action)
      if (values) values.push(value)
      else byAction.set(action, [value])
    }
    return median([...byAction.values()].map(median))
  }

  /**
   * The median of ρ over the casters with samples of the kind, for a caster without samples of its own.
   * @param all Every sample since the zone changed, instead of the last CALIBRATION_WINDOW
   * @returns null when no caster has samples of the kind
   */
  medianPerPotency(kind: PeriodicKind, all = false): number | null {
    const values: number[] = []
    for (const key of this.samples.keys()) {
      if (!key.endsWith(`:${kind}`)) continue
      const value = this.perPotency(Number(key.slice(0, key.indexOf(':'))), kind, all)
      if (value !== null) values.push(value)
    }
    return values.length ? median(values) : null
  }

  clear(): void {
    this.samples.clear()
  }
}
