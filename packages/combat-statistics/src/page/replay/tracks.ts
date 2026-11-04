import type { Track } from '../../view-model.js'

/** Samples further apart than this are not interpolated: the actor stays put until the next one */
export const GAP_MS = 2000
/** Actors further apart than this are at different places; samples further apart than this are a teleport */
export const FAR_METERS = 60
/** An enemy without an actorDied shows this long after its last sample */
const LINGER_MS = 1000

export interface Pose {
  x: number
  z: number
  rotation: number
  /** 0–1, NaN when unknown */
  hp: number
}

/** The index of the last sample at or before the time, -1 before the first */
export function sampleAt(t: Uint32Array, time: number): number {
  let low = 0,
    high = t.length - 1,
    found = -1
  while (low <= high) {
    const middle = (low + high) >> 1
    if (t[middle] <= time) {
      found = middle
      low = middle + 1
    } else high = middle - 1
  }
  return found
}

/** Where the actor is at the time; null before its first sample */
export function poseAt(track: Track, time: number): Pose | null {
  const i = sampleAt(track.t, time)
  if (i < 0) return null
  const sample = (index: number): Pose => ({
    x: track.x[index],
    z: track.z[index],
    rotation: track.rotation[index],
    hp: track.hp[index],
  })
  const next = i + 1
  if (next >= track.t.length || track.t[next] - track.t[i] > GAP_MS) return sample(i)
  if (Math.hypot(track.x[next] - track.x[i], track.z[next] - track.z[i]) > FAR_METERS) return sample(i)
  const f = (time - track.t[i]) / (track.t[next] - track.t[i])
  const lerp = (a: number, b: number) => a + (b - a) * f
  const [a, b] = [sample(i), sample(next)]
  return {
    x: lerp(a.x, b.x),
    z: lerp(a.z, b.z),
    // Angles do not interpolate across the wrap, so the facing takes the nearer sample.
    rotation: f < 0.5 ? a.rotation : b.rotation,
    hp: Number.isNaN(a.hp) || Number.isNaN(b.hp) ? (f < 0.5 ? a.hp : b.hp) : lerp(a.hp, b.hp),
  }
}

/** Whether a member is down: it died at or before the time and no sample since shows it with HP again */
export function isDown(track: Track, deaths: readonly number[], time: number): boolean {
  let died = -1
  for (const t of deaths) if (t <= time && t > died) died = t
  if (died < 0) return false
  for (let i = sampleAt(track.t, time); i >= 0 && track.t[i] > died; i--) if (track.hp[i] > 0) return false
  return true
}

/** Members show from their first sample to the end of the fight */
export const memberShown = (track: Track, time: number) => track.t.length > 0 && time >= track.t[0]

/** Enemies show from their first sample until they die, or a second after their last sample */
export function enemyShown(track: Track, diedAt: number | null, time: number): boolean {
  if (!track.t.length || time < track.t[0]) return false
  return diedAt !== null ? time < diedAt : time <= track.t[track.t.length - 1] + LINGER_MS
}
