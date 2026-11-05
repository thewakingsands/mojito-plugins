import type { AppliedStatus } from './input.js'

const APPLY_ON_TARGET = 14
const APPLY_ON_SOURCE = 15

/**
 * The statuses the raw entries of an effect target apply.
 * @param rawEntries The 8 effect entries of the target, each as [low u32, high u32]
 */
export function parseStatusEntries(rawEntries: readonly (readonly [number, number])[]): AppliedStatus[] {
  const applied: AppliedStatus[] = []
  for (const [low, high] of rawEntries) {
    const type = low & 0xff
    if (type !== APPLY_ON_TARGET && type !== APPLY_ON_SOURCE) continue
    applied.push({
      status: high >>> 16,
      onSource: type === APPLY_ON_SOURCE,
      byte1: (low >>> 8) & 0xff,
      byte2: (low >>> 16) & 0xff,
    })
  }
  return applied
}
