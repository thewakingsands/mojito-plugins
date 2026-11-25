// Copyright (c) FFCafe. Licensed under AGPL-3.0-only.
import type { ClockState } from '@ffcafe/mojito-plugin-sdk'
import type { EurekaCatalog } from './eureka-types.js'

export interface ExplorationStateContext {
  sessionId: string | null
  characterGeneration: number
  clockGeneration: number
  zoneEpoch: number
  catalogRevision: number
  territoryId: number | null
}
export interface ExplorationContext extends ExplorationStateContext {
  clock: ClockState
}
export interface WorldPosition {
  x: number
  y: number | null
  z: number
}
export interface MapProjection {
  mapId: number
  resource?: string
  name: string
  sizeFactor: number
  offset: [number, number]
}
export interface MapPosition {
  mapId: number
  x: number
  y: number
}
export type HuntRank = 'B' | 'A' | 'S' | 'SS'
export type TerritoryKind = 'field' | 'town' | 'eureka' | 'other'
export interface HuntDefinition {
  bNpcBase: number
  bNpcName: number
  name: string
  rank: HuntRank | null
}
export interface ExplorationSource {
  territories: Record<number, { mapId: number | null; weatherRateId: number | null; use: number }>
  maps: Record<number, { resource: string; territoryId: number | null; isEvent: boolean | null }>
  treasures: Record<number, { levelId: number; territoryId: number | null; world: WorldPosition; mapId: number }[]>
  fatePositions: Record<number, { territoryId: number; mapId: number; x: number; z: number }>
  aetherytes: Record<number, { id: number; name: string; world: { x: number; y: number; z: number } }[]>
}
export interface TreasureTarget {
  itemId: number
  spotIndex: number
  levelId: number
  territoryId: number | null
  mapId: number
  placeName: string
  x: number
  y: number
  z: number | null
  zStatus: 'known' | 'hidden' | 'unavailable'
  world: WorldPosition
}
export interface ExplorationCatalog {
  maps: Record<number, MapProjection>
  territoryMaps: Record<number, number | null>
  /** The territory's own map and how many different usable maps it has; unlike territoryMaps, they may be several. */
  territoryDefaults: Record<number, { mapId: number | null; maps: number }>
  territoryKinds: Record<number, TerritoryKind>
  aetherytes: ExplorationSource['aetherytes']
  targets: Record<number, TreasureTarget[]>
  hunts: HuntDefinition[]
  huntsAvailable: boolean
  heightAvailable: boolean
  eureka: Record<number, EurekaCatalog>
  mapIssues: Record<number, string>
}
export interface NavigationState {
  context: ExplorationStateContext
  status: 'ready' | 'no-target' | 'waiting' | 'other-territory' | 'unavailable'
  reason: string | null
  target:
    | (Omit<TreasureTarget, 'world'> & {
        aetheryte: { name: string; distanceM: number; position: MapPosition | null } | null
      })
    | null
  /** Packet time of the first report of the current treasure map. */
  targetSince: number | null
  player: { x: number; y: number; headingDegrees: number | null } | null
  guidance: {
    distanceM: number
    heightDifferenceM: number | null
    bearingDegrees: number | null
    relativeDegrees: number | null
    near: boolean
  } | null
}
export interface LocationState {
  context: ExplorationStateContext
  status: 'ready' | 'waiting' | 'unavailable'
  reason: string | null
  territoryId: number | null
  mapId: number | null
  floorConfirmed: boolean
  kind: TerritoryKind | null
  player: { x: number; y: number; headingDegrees: number | null } | null
}
export interface HuntEntry {
  actorId: number
  bNpcBase: number
  bNpcName: number
  name: string
  rank: HuntRank | null
  state: 'observed' | 'last-seen' | 'ended' | 'position-unknown'
  position: MapPosition | null
  lastObservedAt: number | null
  hpPercent: number | null
  distanceM: number | null
  heightDifferenceM: number | null
}
export interface HuntState {
  context: ExplorationStateContext
  status: 'ready' | 'waiting' | 'unavailable'
  reason: string | null
  mapId: number | null
  entries: HuntEntry[]
}
