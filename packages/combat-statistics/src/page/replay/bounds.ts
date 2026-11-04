/** Each side of the view spans at least this much, so that actors standing together are not magnified too far */
const MIN_SPAN_METERS = 30
/** The room around the actors, for their icons and labels: this many pixels, at most this share of the short side */
const PADDING_PIXELS = 36
const PADDING_SHARE = 0.2
export const GRID_METERS = 5

/** The game coordinates the map shows: x to the right, z down, as on the game's map */
export interface Bounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

/** A range of game coordinates the actors take, before it is fitted to a map */
export type Box = Bounds

/** The range to draw for a box on a map of this size: padded, with the same scale on both axes */
export function fitBounds(box: Box, width: number, height: number): Bounds {
  if (width <= 0 || height <= 0) return box
  const padding = Math.min(PADDING_PIXELS, Math.min(width, height) * PADDING_SHARE)
  const metersPerPixel = Math.max(
    Math.max(box.maxX - box.minX, MIN_SPAN_METERS) / (width - 2 * padding),
    Math.max(box.maxZ - box.minZ, MIN_SPAN_METERS) / (height - 2 * padding),
  )
  const centerX = (box.minX + box.maxX) / 2,
    centerZ = (box.minZ + box.maxZ) / 2
  return {
    minX: centerX - (width / 2) * metersPerPixel,
    maxX: centerX + (width / 2) * metersPerPixel,
    minZ: centerZ - (height / 2) * metersPerPixel,
    maxZ: centerZ + (height / 2) * metersPerPixel,
  }
}

/** The coordinates of the grid lines between min and max */
export function gridLines(min: number, max: number): number[] {
  const lines: number[] = []
  for (let value = Math.ceil(min / GRID_METERS) * GRID_METERS; value <= max; value += GRID_METERS) lines.push(value)
  return lines
}

/** Pixels of a game position on a map of this size */
export function project(bounds: Bounds, width: number, height: number, x: number, z: number): [number, number] {
  // A map not measured yet has an unfitted box, which is empty for a lone actor.
  if (width <= 0 || height <= 0) return [0, 0]
  return [
    ((x - bounds.minX) / (bounds.maxX - bounds.minX)) * width,
    ((z - bounds.minZ) / (bounds.maxZ - bounds.minZ)) * height,
  ]
}
