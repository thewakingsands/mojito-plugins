/** A hit that tells whether it was a critical or a direct hit, and the rate its modifiers added */
export interface RateSample {
  hit: boolean
  delta: number
}

/** The mode of the prior Beta(2, 8), the estimate without samples */
export const PRIOR_RATE = 0.125
const LOW = 0.001
const HIGH = 0.65
const TOLERANCE = 1e-6
const CLAMP = 1e-9
const GOLDEN = (Math.sqrt(5) - 1) / 2

const clamp = (value: number) => Math.min(1 - CLAMP, Math.max(CLAMP, value))

/** The log posterior of the natural rate with the prior Beta(2, 8) */
function logPosterior(rate: number, samples: readonly RateSample[]): number {
  let sum = Math.log(rate) + 7 * Math.log(1 - rate)
  for (const { hit, delta } of samples) {
    const p = clamp(rate + delta)
    sum += hit ? Math.log(p) : Math.log(1 - p)
  }
  return sum
}

/**
 * The maximum a posteriori natural rate, without the rates the modifiers added; golden section search on
 * [0.001, 0.65].
 */
export function estimateRate(samples: readonly RateSample[]): number {
  if (samples.length === 0) return PRIOR_RATE
  let low = LOW
  let high = HIGH
  let left = high - GOLDEN * (high - low)
  let right = low + GOLDEN * (high - low)
  let leftValue = logPosterior(left, samples)
  let rightValue = logPosterior(right, samples)
  while (high - low >= TOLERANCE) {
    if (leftValue < rightValue) {
      low = left
      left = right
      leftValue = rightValue
      right = low + GOLDEN * (high - low)
      rightValue = logPosterior(right, samples)
    } else {
      high = right
      right = left
      rightValue = leftValue
      left = high - GOLDEN * (high - low)
      leftValue = logPosterior(left, samples)
    }
  }
  return (low + high) / 2
}

interface CasterRates {
  critical: RateSample[]
  direct: RateSample[]
  /** The estimates of the samples so far, dropped when a sample comes */
  estimate: { critical: number; direct: number } | null
}

/** The critical and direct hit samples of every caster since the zone changed */
export class RateSamples {
  private casters = new Map<number, CasterRates>()

  private entry(caster: number): CasterRates {
    let entry = this.casters.get(caster)
    if (!entry) {
      entry = { critical: [], direct: [], estimate: null }
      this.casters.set(caster, entry)
    }
    return entry
  }

  addCritical(caster: number, hit: boolean, delta: number): void {
    const entry = this.entry(caster)
    entry.critical.push({ hit, delta })
    entry.estimate = null
  }

  addDirect(caster: number, hit: boolean, delta: number): void {
    const entry = this.entry(caster)
    entry.direct.push({ hit, delta })
    entry.estimate = null
  }

  /** ĉ and d̂ of the caster */
  rates(caster: number): { critical: number; direct: number } {
    const entry = this.casters.get(caster)
    if (!entry) return { critical: PRIOR_RATE, direct: PRIOR_RATE }
    entry.estimate ??= { critical: estimateRate(entry.critical), direct: estimateRate(entry.direct) }
    return entry.estimate
  }

  clear(): void {
    this.casters.clear()
  }
}
