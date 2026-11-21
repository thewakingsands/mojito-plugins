// Copyright (c) FFCafe. Licensed under AGPL-3.0-only.
import type { PlayerState } from '@ffcafe/mojito-plugin-sdk'
import { freshField, headingDegrees, observedPlayerPosition, project } from './coordinates.js'
import type { ExplorationCatalog, ExplorationContext, LocationState } from './types.js'

/** The map shown for the current territory and the player on it; independent of any treasure map. */
export function locationState(
  context: ExplorationContext,
  catalog: ExplorationCatalog | null,
  player: PlayerState | null,
): LocationState {
  const { clock: _, ...published } = context
  const state: LocationState = {
    context: published,
    status: 'waiting',
    reason: '等待当前区域',
    territoryId: context.territoryId,
    mapId: null,
    floorConfirmed: false,
    kind: null,
    player: null,
  }
  if (context.territoryId === null) return state
  if (!catalog) return { ...state, reason: '等待客户端资料' }
  state.kind = catalog.territoryKinds[context.territoryId] ?? null
  const defaults = catalog.territoryDefaults[context.territoryId]
  const mapId = defaults?.mapId ?? null
  if (mapId === null) return { ...state, status: 'unavailable', reason: '区域地图关联尚未确认' }
  state.mapId = mapId
  // Nothing reports which of several maps the player is on, so only a single-map territory places the player.
  if (defaults.maps !== 1) return { ...state, status: 'unavailable', reason: '当前所在的地图未确认' }
  state.floorConfirmed = true
  const position = observedPlayerPosition(player, context, null)
  if (!position) return { ...state, status: 'unavailable', reason: '本人位置不可用' }
  const rotation = freshField(player?.rotation, context, null)
  const point = project(position.value, catalog.maps[mapId])
  state.player = {
    x: point.x,
    y: point.y,
    headingDegrees: rotation && Number.isFinite(rotation.value) ? headingDegrees(rotation.value) : null,
  }
  state.status = 'ready'
  state.reason = null
  return state
}
