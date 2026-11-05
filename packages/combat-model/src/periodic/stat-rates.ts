import type { LevelModifier } from '../defs.js'

const CRITICAL_SCALE = 200
const CRITICAL_BASE = 50
const DIRECT_SCALE = 550

/**
 * The natural critical and direct hit rates of the attributes at the level; the game rounds to thousandths downward.
 * @returns null when an attribute is below the base of the level, which the formula does not cover
 */
export function ratesOfStats(
  stats: { criticalHit: number; directHit: number },
  modifier: LevelModifier,
): { critical: number; direct: number } | null {
  const { sub, div } = modifier
  if (stats.criticalHit < sub || stats.directHit < sub) return null
  return {
    critical: Math.floor((CRITICAL_SCALE * (stats.criticalHit - sub)) / div + CRITICAL_BASE) / 1000,
    direct: Math.floor((DIRECT_SCALE * (stats.directHit - sub)) / div) / 1000,
  }
}
