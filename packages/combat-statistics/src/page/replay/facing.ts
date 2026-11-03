/**
 * The SVG rotation in degrees, clockwise, of a facing ring whose arrow points up at 0. The game's rotation is 0
 * toward +z, down on the map, and grows counterclockwise.
 */
export const ringRotation = (rotation: number) => 180 - (rotation * 180) / Math.PI
