import type { PeriodicKind } from '../defs.js'

/** The spread of the base damage around q, as the log ratio */
const BASE_SPREAD = 0.12
/** The spread of the critical rate around its estimate */
const RATE_SPREAD = 0.06
/** The damage varies uniformly by ±5% */
const ROLL_VARIANCE = 0.1 ** 2 / 12
const DIRECT_BONUS = 1.25
const MAX_RATE = 0.999
const BYTE = 256
const BASE_LIMIT = 65536
const CRIT_CANDIDATES = 4

export interface PriorInput {
  kind: PeriodicKind
  /** The reference base amount ρ × p × M */
  base: number
  /** Byte 1 of the entry that applied the status, the low byte of its base damage */
  lowByte: number | null
  /** Byte 2, the low byte of its critical rate in thousandths */
  critByte: number | null
  /** ĉ and d̂ of the caster */
  critical: number
  direct: number
  /** Δc and Δd of the snapshot */
  critDelta: number
  directDelta: number
}

export interface Prior {
  /** μ, the mean amount of a tick */
  mean: number
  /** r, the variance a tick keeps when its mean is known */
  variance: number
  /** K, the multiplier of a critical hit */
  criticalMultiplier: number
}

export interface Candidate {
  base: number
  rate: number
  weight: number
}

/** The candidates of the base damage and the critical rate of a damage snapshot, with their normalized weights */
export function damageCandidates(input: PriorInput): Candidate[] {
  const expected = Math.min(MAX_RATE, input.critical + input.critDelta)
  const bases: number[] = []
  if (input.lowByte === null) bases.push(input.base)
  else for (let base = input.lowByte; base < BASE_LIMIT; base += BYTE) if (base > 0) bases.push(base)

  let rates: number[] = []
  if (input.critByte !== null) {
    for (let n = 0; n < CRIT_CANDIDATES; n++) {
      const rate = (input.critByte + BYTE * n) / 1000
      if (rate >= input.critDelta && rate <= 1) rates.push(rate)
    }
  }
  if (rates.length === 0) rates = [expected]

  const candidates: Candidate[] = []
  for (const base of bases) {
    const baseTerm = -0.5 * (Math.log(base / input.base) / BASE_SPREAD) ** 2 - Math.log(base)
    for (const rate of rates) {
      const weight = baseTerm - 0.5 * ((rate - expected) / RATE_SPREAD) ** 2
      candidates.push({ base, rate, weight })
    }
  }
  const top = Math.max(...candidates.map((item) => item.weight))
  let sum = 0
  for (const item of candidates) {
    item.weight = Math.exp(item.weight - top)
    sum += item.weight
  }
  for (const item of candidates) item.weight /= sum
  return candidates
}

/** K, the multiplier of a critical hit, from the natural critical rate; not from the table of the levels */
export const criticalMultiplierOf = (critical: number) => 1.35 + critical

/** The first and second moments of the amount of a tick of the snapshot */
export function computePrior(input: PriorInput): Prior {
  const criticalMultiplier = criticalMultiplierOf(input.critical)
  const K = criticalMultiplier
  let candidates: Candidate[]
  let direct: number
  if (input.kind === 'damage') {
    candidates = damageCandidates(input)
    direct = Math.min(MAX_RATE, input.direct + input.directDelta)
  } else {
    // Heals use neither the low bytes nor the critical rate modifiers, and cannot be direct hits
    candidates = [{ base: input.base, rate: input.critical, weight: 1 }]
    direct = 0
  }

  let mean = 0
  let variance = 0
  for (const { base, rate, weight } of candidates) {
    const h1 = (1 + rate * (K - 1)) * (1 + (DIRECT_BONUS - 1) * direct)
    const h2 = (1 + rate * (K * K - 1)) * (1 + direct * (DIRECT_BONUS ** 2 - 1))
    mean += weight * base * h1
    variance += weight * base * base * ((1 + ROLL_VARIANCE) * h2 - h1 * h1)
  }
  return { mean, variance: Math.max(1, variance), criticalMultiplier }
}
