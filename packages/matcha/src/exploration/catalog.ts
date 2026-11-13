// Copyright (c) FFCafe. Licensed under AGPL-3.0-only.
import type { Cell, DataRow, DataService } from '@ffcafe/mojito-plugin-sdk'
import type { GameCatalog } from '../client-data.js'
import { project } from './coordinates.js'
import type { ExplorationCatalog, HuntRank } from './types.js'

const cells = (row: DataRow) => row.subrows[0]?.cells ?? []
const numeric = (row: Cell[], index: number) => {
  const c = row[index]
  if (c?.type !== 'number' || !Number.isFinite(c.value)) throw new Error(`Unsupported exploration column ${index}`)
  return c.value
}
const text = (row: Cell[], index: number) => {
  const c = row[index]
  if (c?.type !== 'string') throw new Error(`Unsupported exploration text ${index}`)
  return c.value
}
// cactbot 8d12b650, util/gen_hunt_data.py; only applied to matching client NM rows.
const ssBases = new Set([10422, 13775, 10755, 13938])
const rank = (base: number, value: number): HuntRank | null =>
  ssBases.has(base) ? 'SS' : (({ 1: 'B', 2: 'A', 3: 'S' } as const)[value as 1 | 2 | 3] ?? null)

export async function loadExplorationCatalog(
  data: DataService,
  base: GameCatalog,
  language: string,
  signal: AbortSignal,
): Promise<ExplorationCatalog> {
  const read = async (name: string, localized = false, selectedIds?: number[]): Promise<DataRow[]> => {
    const lang = localized ? language : 'none',
      rows: DataRow[] = []
    signal.throwIfAborted()
    const ids = selectedIds ?? (await data.rowIds(name, lang, { signal }))
    for (let i = 0; i < ids.length; i += 128) {
      signal.throwIfAborted()
      rows.push(...(await data.rows(name, ids.slice(i, i + 128), lang, { signal })))
    }
    signal.throwIfAborted()
    return rows
  }
  const optional = async <T>(load: () => Promise<T>): Promise<T | null> => {
    try {
      return await load()
    } catch {
      signal.throwIfAborted()
      return null
    }
  }
  const result: ExplorationCatalog = {
    maps: {},
    territoryMaps: {},
    targets: {},
    hunts: [],
    huntsAvailable: false,
    heightAvailable: false,
    eureka: {},
    mapIssues: {},
  }
  for (const [id, map] of Object.entries(base.maps)) {
    if (map.sizeFactor > 0 && Number.isFinite(map.sizeFactor) && map.offset.every(Number.isFinite))
      result.maps[+id] = { ...map, mapId: +id, resource: base.exploration.maps[+id]?.resource }
  }
  for (const [id, territory] of Object.entries(base.exploration.territories)) {
    const mapId = territory.mapId,
      canonical = mapId === null ? undefined : base.exploration.maps[mapId]
    const candidates = Object.entries(base.exploration.maps).filter(
      ([, m]) => m.territoryId === +id && m.isEvent === false && m.resource && m.resource !== 'default/00',
    )
    const projections = new Set(
      candidates.flatMap(([id, m]) => {
        const map = result.maps[+id]
        return map ? [JSON.stringify([m.resource, map.sizeFactor, ...map.offset])] : []
      }),
    )
    const usable =
      mapId !== null &&
      result.maps[mapId] &&
      canonical?.territoryId === +id &&
      canonical.isEvent === false &&
      canonical.resource &&
      canonical.resource !== 'default/00' &&
      projections.size === 1
    result.territoryMaps[+id] = usable ? mapId : null
    if (!usable) result.mapIssues[+id] = '区域地图关联尚未确认'
  }
  const heights = await optional(
    async () => new Map((await read('TerritoryTypeTransient')).map((r) => [r.rowId, numeric(cells(r), 0)])),
  )
  result.heightAvailable = heights !== null && heights.size > 0
  for (const [item, rows] of Object.entries(base.exploration.treasures)) {
    const targets: ExplorationCatalog['targets'][number] = []
    rows.forEach((row, spotIndex) => {
      const old = base.treasures[item]?.[spotIndex],
        map = result.maps[row.mapId]
      if (!old || !map) return
      const offset = row.territoryId === null ? undefined : heights?.get(row.territoryId)
      const hidden = offset === -10000
      const z = !hidden && offset !== undefined && row.world.y !== null ? (row.world.y - offset) / 100 : null
      targets[spotIndex] = {
        itemId: +item,
        spotIndex,
        levelId: row.levelId,
        territoryId: row.territoryId,
        mapId: row.mapId,
        placeName: map.name,
        x: old.x,
        y: old.y,
        z,
        zStatus: hidden ? 'hidden' : z === null ? 'unavailable' : 'known',
        world: row.world,
      }
    })
    result.targets[+item] = targets
  }
  const hunts = await optional(async () => {
    const rows = await read('NotoriousMonster')
    const wantedNames = [...new Set(rows.map((r) => numeric(cells(r), 2)).filter((id) => id > 0))]
    const names = new Map((await read('BNpcName', true, wantedNames)).map((r) => [r.rowId, text(cells(r), 0)]))
    return rows.flatMap((r) => {
      const c = cells(r),
        bNpcBase = numeric(c, 0),
        bNpcName = numeric(c, 2),
        name = names.get(bNpcName)
      return bNpcBase && bNpcName && name ? [{ bNpcBase, bNpcName, name, rank: rank(bNpcBase, numeric(c, 1)) }] : []
    })
  })
  result.huntsAvailable = hunts !== null && hunts.length > 0
  result.hunts = hunts ?? []
  const weather = await optional(async () => {
    const names = new Map((await read('Weather', true)).map((r) => [r.rowId, text(cells(r), 1)]))
    const rates = new Map(
      (await read('WeatherRate')).map((r) => {
        const c = cells(r),
          entries = []
        for (let i = 0; i < 8; i++) {
          const weatherId = numeric(c, i * 2),
            rate = numeric(c, i * 2 + 1)
          if (rate < 0 || rate > 100 || !Number.isInteger(rate)) throw new Error('Invalid weather rate')
          if (rate) {
            if (!weatherId || !names.has(weatherId)) throw new Error('Missing weather name')
            entries.push({ weatherId, rate })
          }
        }
        return [r.rowId, entries] as const
      }),
    )
    return { names, rates }
  })
  for (const territoryId of [732, 763, 795, 827]) {
    const mapId = result.territoryMaps[territoryId] ?? null
    const weatherId = base.exploration.territories[territoryId]?.weatherRateId
    const rates = weatherId === null || weatherId === undefined ? null : (weather?.rates.get(weatherId) ?? null)
    result.eureka[territoryId] = {
      mapId,
      fates: Object.entries(base.fates)
        .filter(([, f]) => f.location === territoryId || f.location === 0)
        .map(([id, f]) => {
          const point = base.exploration.fatePositions[+id],
            map = mapId === null ? undefined : result.maps[mapId]
          return {
            id: +id,
            name: f.name[language] ?? Object.values(f.name)[0] ?? '',
            position: point && map ? project({ x: point.x, y: null, z: point.z }, map) : null,
          }
        }),
      weatherRates: rates?.reduce((sum, r) => sum + r.rate, 0) === 100 ? rates : null,
      weatherNames: weather?.names ?? new Map(),
    }
  }
  signal.throwIfAborted()
  return result
}
