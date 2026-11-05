import { potencyAt, SAMPLE_VARIANTS, type SampleAction } from '../defs.js'

/**
 * The potency of a hit, from the bonus percentage of its effect. The game gives the share of the potency above the
 * base one, floor((potency - base) / potency * 100), so the combo and the positionals need no tracking.
 * @returns null when the level is 0 (unknown) or above maxLevel, or when no single potency gives the percentage
 */
export function samplePotency(
  action: SampleAction,
  level: number,
  maxLevel: number,
  bonusPercent: number,
): number | null {
  const base = potencyAt(action.potency.base, level, maxLevel)
  if (base === null) return null
  if (bonusPercent === 0) return base
  let found: number | null = null
  for (const variant of SAMPLE_VARIANTS) {
    const table = action.potency[variant]
    if (!table) continue
    const potency = potencyAt(table, level, maxLevel)
    if (potency === null || Math.floor(((potency - base) / potency) * 100) !== bonusPercent) continue
    // Two potencies with the same percentage cannot be told apart
    if (found !== null) return null
    found = potency
  }
  return found
}
