import type { CombatantState, Field, PlayerState } from '@ffcafe/mojito-plugin-sdk'
import type { ExplorationCatalog, ExplorationContext } from './types.js'
export const field = <T>(value: T, observedAt = 10000): Field<T> => ({
  state: 'ok',
  value,
  observedAt,
  timeBase: 'packet-unix',
  from: 'memory',
})
export const context = (now = 10000): ExplorationContext => ({
  sessionId: 'synthetic',
  characterGeneration: 1,
  clockGeneration: 1,
  zoneEpoch: 1,
  catalogRevision: 1,
  territoryId: 148,
  clock: { now, base: 'packet-unix', generation: 1, source: 'live', paused: false },
})
export const player = (): PlayerState => ({
  actorId: field(1),
  position: field({ x: 0, y: 0, z: 0 }),
  rotation: field(0),
})
export const monster = (id = 7): CombatantState => ({
  id,
  objectKind: field(2),
  bNpcBase: field(100),
  bNpcName: field(200),
  position: field({ x: 3, y: -2, z: -4 }),
  hpCur: field(100),
  hpMax: field(100),
})
export const catalog = (): ExplorationCatalog => ({
  maps: { 4: { mapId: 4, name: 'Synthetic plain', resource: 'test/00', sizeFactor: 100, offset: [0, 0] } },
  territoryMaps: { 148: 4 },
  targets: {
    88: [
      {
        itemId: 88,
        spotIndex: 0,
        levelId: 1,
        territoryId: 148,
        mapId: 4,
        placeName: 'Synthetic plain',
        x: 21.5,
        y: 21.3,
        z: -0.02,
        zStatus: 'known',
        world: { x: 0, y: -2, z: -10 },
      },
    ],
  },
  hunts: [{ bNpcBase: 100, bNpcName: 200, name: 'Synthetic mark', rank: 'A' }],
  huntsAvailable: true,
  heightAvailable: true,
  eureka: {},
  mapIssues: {},
})
