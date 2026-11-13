// Copyright (c) FFCafe. Licensed under AGPL-3.0-only.
import type { Field, PlayerState } from '@ffcafe/mojito-plugin-sdk'
import type { ExplorationContext, MapProjection, WorldPosition } from './types.js'

export const observationLifetimeMs = 2000
export function freshField<T>(
  field: Field<T> | undefined,
  context: ExplorationContext,
  boundaryAt: number | null,
): Extract<Field<T>, { state: 'ok' }> | null {
  if (field?.state !== 'ok' || context.clock.now === null || context.clock.base !== field.timeBase) return null
  const age = context.clock.now - field.observedAt
  return Number.isFinite(field.observedAt) &&
    age >= 0 &&
    age <= observationLifetimeMs &&
    (boundaryAt === null || field.observedAt >= boundaryAt)
    ? field
    : null
}
export const fieldValue = <T>(field: Field<T> | undefined): T | null => (field?.state === 'ok' ? field.value : null)
export const finitePosition = (p: WorldPosition): boolean =>
  Number.isFinite(p.x) && Number.isFinite(p.z) && (p.y === null || Number.isFinite(p.y))
export function mapCoordinate(value: number, offset: number, sizeFactor: number): number {
  const scale = sizeFactor / 100
  return (41 / scale) * (((value + offset) * scale + 1024) / 2048) + 1
}
export function project(position: WorldPosition, map: MapProjection) {
  return {
    mapId: map.mapId,
    x: mapCoordinate(position.x, map.offset[0], map.sizeFactor),
    y: mapCoordinate(position.z, map.offset[1], map.sizeFactor),
  }
}
export const degrees = (angle: number) => ((angle % 360) + 360) % 360
// Native rotation is zero facing south, increasing toward east.
export const headingDegrees = (rotation: number) => degrees(180 - (rotation * 180) / Math.PI)
export function guidance(from: WorldPosition, to: WorldPosition, heading: number | null) {
  const dx = to.x - from.x,
    dz = to.z - from.z
  const distanceM = Math.hypot(dx, dz),
    near = distanceM < 1
  const bearingDegrees = near ? null : degrees((Math.atan2(dx, -dz) * 180) / Math.PI)
  return {
    distanceM,
    heightDifferenceM: to.y === null || from.y === null ? null : to.y - from.y,
    bearingDegrees,
    relativeDegrees:
      bearingDegrees === null || heading === null ? null : ((bearingDegrees - heading + 540) % 360) - 180,
    near,
  }
}

export function observedPlayerPosition(
  player: PlayerState | null,
  context: ExplorationContext,
  boundaryAt: number | null,
) {
  const actorId = fieldValue(player?.actorId)
  if (actorId === null || !Number.isSafeInteger(actorId) || actorId <= 0) return null
  const position = freshField(player?.position, context, boundaryAt)
  return position && finitePosition(position.value) ? position : null
}
