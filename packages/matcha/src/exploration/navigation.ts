// Copyright (c) FFCafe. Licensed under AGPL-3.0-only.
import type { PlayerState } from '@ffcafe/mojito-plugin-sdk'
import { freshField, guidance, headingDegrees, observedPlayerPosition, project } from './coordinates.js'
import type { ExplorationCatalog, ExplorationContext, NavigationState } from './types.js'

export function navigationState(
  context: ExplorationContext,
  catalog: ExplorationCatalog | null,
  identity: { itemId: number; spotIndex: number } | null,
  player: PlayerState | null,
  boundaryAt: number | null,
): NavigationState {
  const state: NavigationState = {
    context,
    status: 'waiting',
    reason: '等待客户端资料',
    target: null,
    player: null,
    guidance: null,
  }
  if (!identity) return { ...state, status: 'no-target', reason: null }
  if (!catalog) return state
  const target = catalog.targets[identity.itemId]?.[identity.spotIndex]
  if (!target) return { ...state, status: 'unavailable', reason: '藏宝点资料不可用' }
  const { world, ...display } = target
  state.target = display
  if (target.territoryId === null) return { ...state, status: 'unavailable', reason: '藏宝点区域未知' }
  if (context.territoryId === null) return { ...state, reason: '等待当前区域' }
  if (target.territoryId !== context.territoryId)
    return { ...state, status: 'other-territory', reason: '目标位于其他区域' }
  const map = catalog.maps[target.mapId]
  const canonical = catalog.territoryMaps[context.territoryId]
  if (!map || canonical === null || canonical === undefined || !equivalentProjection(map, catalog.maps[canonical]))
    return { ...state, status: 'unavailable', reason: '区域地图关联尚未确认' }
  const position = observedPlayerPosition(player, context, boundaryAt)
  if (!position) return { ...state, status: 'unavailable', reason: '本人位置不可用' }
  const rotation = freshField(player?.rotation, context, boundaryAt)
  const heading = rotation && Number.isFinite(rotation.value) ? headingDegrees(rotation.value) : null
  const point = project(position.value, map)
  state.player = { x: point.x, y: point.y, observedAt: position.observedAt, headingDegrees: heading }
  state.guidance = guidance(position.value, world, heading)
  state.status = 'ready'
  state.reason = null
  return state
}
function equivalentProjection(
  a: ExplorationCatalog['maps'][number],
  b: ExplorationCatalog['maps'][number] | undefined,
) {
  return (
    b &&
    a.resource === b.resource &&
    a.sizeFactor === b.sizeFactor &&
    a.offset[0] === b.offset[0] &&
    a.offset[1] === b.offset[1]
  )
}
