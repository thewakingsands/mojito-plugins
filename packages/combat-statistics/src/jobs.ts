export type Role = 'tank' | 'healer' | 'dps'

// ClassJob IDs of the tank and healer classes and jobs; every other combat class deals damage. Read from the IDs
// rather than the ClassJob sheet because the column of Role is not fixed across game versions.
const TANKS = new Set([1, 3, 19, 21, 32, 37])
const HEALERS = new Set([6, 24, 28, 33, 40])

export function roleOf(job: number | null): Role | null {
  if (job === null) return null
  return TANKS.has(job) ? 'tank' : HEALERS.has(job) ? 'healer' : 'dps'
}

/** The game's job icon without a frame, ui/icon/062000/0621xx */
export const jobIcon = (job: number) => 62100 + job
