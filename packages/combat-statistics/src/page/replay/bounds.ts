import type { Track } from '../../view-model.js'

/** Meters of room around the actors */
const MARGIN = 3
export const GRID_METERS = 5

/** The game coordinates the map shows: x to the right, z down, as on the game's map */
export interface Bounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

/**
 * Every position of the tracks with a margin, the short side widened about its center so that both axes take the
 * same scale on a map of this size; null without positions.
 */
export function mapBounds(tracks: readonly Track[], width: number, height: number): Bounds | null {
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity
  for (const track of tracks)
    for (let i = 0; i < track.t.length; i++) {
      minX = Math.min(minX, track.x[i])
      maxX = Math.max(maxX, track.x[i])
      minZ = Math.min(minZ, track.z[i])
      maxZ = Math.max(maxZ, track.z[i])
    }
  if (minX > maxX) return null
  const bounds = { minX: minX - MARGIN, maxX: maxX + MARGIN, minZ: minZ - MARGIN, maxZ: maxZ + MARGIN }
  if (width <= 0 || height <= 0) return bounds
  const spanX = bounds.maxX - bounds.minX,
    spanZ = bounds.maxZ - bounds.minZ
  const aspect = width / height
  if (spanX / spanZ < aspect) {
    const extra = (spanZ * aspect - spanX) / 2
    bounds.minX -= extra
    bounds.maxX += extra
  } else {
    const extra = (spanX / aspect - spanZ) / 2
    bounds.minZ -= extra
    bounds.maxZ += extra
  }
  return bounds
}

/** The coordinates of the grid lines between min and max */
export function gridLines(min: number, max: number): number[] {
  const lines: number[] = []
  for (let value = Math.ceil(min / GRID_METERS) * GRID_METERS; value <= max; value += GRID_METERS) lines.push(value)
  return lines
}

/** Pixels of a game position on a map of this size */
export function project(bounds: Bounds, width: number, height: number, x: number, z: number): [number, number] {
  return [
    ((x - bounds.minX) / (bounds.maxX - bounds.minX)) * width,
    ((z - bounds.minZ) / (bounds.maxZ - bounds.minZ)) * height,
  ]
}
