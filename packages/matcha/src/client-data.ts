// Copyright (c) FFCafe. Licensed under AGPL-3.0-only.
import type { Cell, DataRow, DataService } from '@ffcafe/mojito-plugin-sdk'
import type { ExplorationSource } from './exploration/types.js'
import type { NotebookMapping } from './initial-data/index.js'
import unlocks from './submarine-unlocks.json'

type Names = Record<string, string>
export interface GameCatalog {
  exploration: ExplorationSource
  fates: Record<string, { name: Names; level: number; patch: number; location: number }>
  patches: Record<string, Names>
  territories: Record<string, Names>
  templates: { name: Names; fate: number[] }[]
  instances: Record<string, { name: Names; level: number; type: number }>
  types: Record<string, Names>
  roulettes: Record<string, Names>
  dynamicEvents: Record<string, { name: Names }>
  worlds: Record<string, { name: string; en: string; region: string; dc: number; dcName: string }>
  fishing: {
    fish: Record<string, string>
    tackle: Record<string, string>
    places: Record<string, string>
    placefish: Record<string, number[]>
  }
  notebook: NotebookMapping
  maps: Record<string, { name: string; sizeFactor: number; offset: [number, number] }>
  treasures: Record<string, { map: number; x: number; y: number }[]>
  submarineMap: Record<
    string,
    {
      name: string
      image: string
      spots: Record<
        string,
        {
          location: string
          parent: string | null
          name: string
          x: number
          y: number
          z: number
          rank: number
          ceruleum: number
          duration: number
          distance: number
          exp: number
        }
      >
    }
  >
  submarineParts: Record<
    string,
    {
      name: string
      itemId: number
      slot: number
      rank: number
      components: number
      surveillance: number
      retrieval: number
      speed: number
      range: number
      favor: number
      class: number
      repairMaterials: number
    }
  >
  submarineRanks: Record<
    string,
    {
      capacity: number
      exp: number
      surveillance: number
      retrieval: number
      speed: number
      range: number
      favor: number
    }
  >
}
export const emptyCatalog = (): GameCatalog => ({
  exploration: { territories: {}, maps: {}, treasures: {}, fatePositions: {} },
  fates: {},
  patches: {},
  territories: {},
  templates: [],
  instances: {},
  types: {},
  roulettes: {},
  dynamicEvents: {},
  worlds: {},
  fishing: { fish: {}, tackle: {}, places: {}, placefish: {} },
  notebook: { fish: {}, spearfish: {} },
  maps: {},
  treasures: {},
  submarineMap: {},
  submarineParts: {},
  submarineRanks: {},
})
const cells = (row: DataRow) => row.subrows[0]?.cells ?? []
function number(row: Cell[], index: number): number {
  const cell = row[index]
  if (cell?.type !== 'number' || !Number.isFinite(cell.value))
    throw new Error(`Unsupported game data numeric column ${index}`)
  return cell.value
}
const optionalNumber = (row: Cell[], index: number): number | null => {
  const cell = row[index]
  return cell?.type === 'number' && Number.isFinite(cell.value) ? cell.value : null
}
function text(row: Cell[], index: number): string {
  const cell = row[index]
  if (cell?.type !== 'string') throw new Error(`Unsupported game data text column ${index}`)
  return cell.value
}
const dictionary = <T>(rows: DataRow[], read: (row: Cell[], id: number) => T) =>
  Object.fromEntries(rows.map((row) => [row.rowId, read(cells(row), row.rowId)]))
const iconPath = (id: number) =>
  `ui/icon/${String(Math.floor(id / 1000) * 1000).padStart(6, '0')}/${String(id).padStart(6, '0')}_hr1.tex`
const coordinate = (value: number, offset: number, size: number) => {
  const scale = size / 100
  return Math.round(((41 / scale) * (((value + offset) * scale + 1024) / 2048) + 1) * 10) / 10
}

/** Read EXH column declaration order, not byte-offset-sorted table exports. */
export class ClientGameData {
  constructor(private readonly data: DataService) {}
  private async rows(sheet: string, ids: number[], language: string, signal: AbortSignal): Promise<DataRow[]> {
    const result: DataRow[] = []
    for (let offset = 0; offset < ids.length; offset += 128) {
      signal.throwIfAborted()
      result.push(...(await this.data.rows(sheet, ids.slice(offset, offset + 128), language, { signal })))
    }
    return result
  }
  private async sheet(sheet: string, language: string, signal: AbortSignal) {
    return this.rows(sheet, await this.data.rowIds(sheet, language, { signal }), language, signal)
  }
  // rowIds accepts ordinary sheets only; the EXD index also enumerates parent rows of subrow sheets.
  private async subrows(sheet: string, ids: number[] | null, signal: AbortSignal) {
    if (ids) return this.rows(sheet, ids, 'none', signal)
    const raw = await this.data.resource(`exd/${sheet}.exh`, { signal })
    if (!raw) throw new Error(`Missing ${sheet} header`)
    const header = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
    const base = 32 + header.getUint16(8) * 4
    const result: number[] = []
    for (let page = 0; page < header.getUint16(10); page++) {
      const start = header.getUint32(base + page * 8)
      const bytes = await this.data.resource(`exd/${sheet}_${start}.exd`, { signal })
      if (!bytes) throw new Error(`Missing ${sheet} page`)
      const index = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      for (let offset = 32; offset < 32 + index.getUint32(8); offset += 8) result.push(index.getUint32(offset))
    }
    return this.rows(sheet, result, 'none', signal)
  }
  async load(language: string, signal: AbortSignal): Promise<GameCatalog> {
    const result = emptyCatalog()
    const read = (sheet: string, localized = false) => this.sheet(sheet, localized ? language : 'none', signal)
    const places = dictionary(await read('PlaceName', true), (c) => text(c, 0))
    const local = (name: string): Names => ({ [language]: name })
    const territories = await read('TerritoryType')
    const territoryRows = new Map(territories.map((r) => [r.rowId, cells(r)]))
    result.territories = dictionary(territories, (c) => local(places[number(c, 5)] ?? ''))
    result.exploration.territories = dictionary(territories, (c) => ({
      mapId: optionalNumber(c, 6),
      weatherRateId: optionalNumber(c, 12),
    }))
    result.patches = Object.fromEntries(
      (await read('ExVersion', true)).map((r) => [r.rowId + 2, local(text(cells(r), 0))]),
    )
    result.types = dictionary(await read('ContentType', true), (c) => local(text(c, 0)))
    result.roulettes = dictionary(await read('ContentRoulette', true), (c) => local(text(c, 0)))
    result.instances = dictionary(await read('ContentFinderCondition', true), (c) => ({
      name: local(text(c, 43)),
      level: number(c, 17),
      type: number(c, 45),
    }))
    const maps = await read('Map')
    result.maps = dictionary(maps, (c) => ({
      name: [places[number(c, 11)], places[number(c, 12)]].filter(Boolean).join(' '),
      sizeFactor: number(c, 7),
      offset: [number(c, 8), number(c, 9)] as [number, number],
    }))
    result.exploration.maps = dictionary(maps, (c) => ({
      resource: c[6]?.type === 'string' ? c[6].value : '',
      territoryId: optionalNumber(c, 15),
      isEvent: c[17]?.type === 'boolean' ? c[17].value : null,
    }))
    const fateRows = await read('Fate', true)
    const dynamicRows = await read('DynamicEvent', true)
    const wanted = new Set(
      [...fateRows.map((r) => number(cells(r), 9)), ...dynamicRows.map((r) => number(cells(r), 5))].filter(Boolean),
    )
    const locations = new Map<number, { territory: number; map: number; x: number; z: number }>()
    const seenPaths = new Set<string>()
    for (const row of territories) {
      const c = cells(row),
        bg = text(c, 1)
      if (!bg || !number(c, 6)) continue
      for (const file of ['planevent', 'planmap']) {
        const path = `bg/${bg.slice(0, bg.lastIndexOf('/') + 1)}${file}.lgb`
        if (seenPaths.has(path)) continue
        seenPaths.add(path)
        signal.throwIfAborted()
        const raw = await this.data.resource(path, { signal })
        if (!raw) continue
        for (const point of sceneLocations(raw, wanted)) {
          if (!locations.has(point.id))
            locations.set(point.id, { territory: row.rowId, map: number(c, 6), x: point.x, z: point.z })
        }
      }
    }
    result.fates = Object.fromEntries(
      fateRows
        .filter((r) => text(cells(r), 0) && !text(cells(r), 0).startsWith('※'))
        .map((row) => {
          const c = cells(row),
            point = locations.get(number(c, 9)),
            territory = point && territoryRows.get(point.territory)
          return [
            row.rowId,
            {
              name: local(text(c, 0)),
              level: number(c, 10),
              location: point?.territory ?? 0,
              patch: territory ? number(territory, 29) + 2 : 0,
            },
          ]
        }),
    )
    for (const row of fateRows) {
      const point = locations.get(number(cells(row), 9))
      if (point)
        result.exploration.fatePositions[row.rowId] = {
          territoryId: point.territory,
          mapId: point.map,
          x: point.x,
          z: point.z,
        }
    }
    const events = new Map(dynamicRows.map((r) => [r.rowId, cells(r)]))
    for (const group of await this.subrows('DynamicEventSet', null, signal)) {
      const zones = new Set(
        group.subrows.flatMap((r) => {
          const event = events.get(number(r.cells, 0))
          const p = event && locations.get(number(event, 5))
          return p ? [p.territory] : []
        }),
      )
      for (const row of group.subrows) {
        const event = events.get(number(row.cells, 0))
        if (!event || !text(event, 11)) continue
        const zone = locations.get(number(event, 5))?.territory ?? (zones.size === 1 ? [...zones][0] : undefined)
        if (zone !== undefined) result.dynamicEvents[zone * 1000 + row.subrowId!] ??= { name: local(text(event, 11)) }
      }
    }
    const notes = await read('RelicNote')
    const noteItems = await this.rows(
      'EventItem',
      [...new Set(notes.map((r) => number(cells(r), 0)).filter(Boolean))],
      language,
      signal,
    )
    const noteNames = dictionary(noteItems, (c) => text(c, 0))
    result.templates = notes
      .filter((r) => number(cells(r), 0))
      .map((r) => ({
        name: local(noteNames[number(cells(r), 0)] ?? ''),
        fate: [25, 27, 29].map((i) => number(cells(r), i)).filter(Boolean),
      }))
    const dcs = dictionary(await read('WorldDCGroupType'), (c) => ({
      name: text(c, 0),
      region: number(c, c.length >= 5 ? 3 : 1),
    }))
    result.worlds = dictionary(
      (await read('World')).filter((r) => {
        const c = cells(r),
          dc = number(c, 4),
          region = dcs[dc]?.region
        return dc !== 0 && text(c, 1) && dcs[dc] && (c[5]?.value === true || region === 5 || region === 6)
      }),
      (c) => {
        const dc = number(c, 4),
          center = dcs[dc]
        return {
          name: text(c, 1),
          en: text(c, 0),
          dc,
          dcName: center.name,
          region: center.region === 5 ? 'china' : 'global',
        }
      },
    )
    const fishRows = await read('FishParameter', true)
    result.notebook.fish = dictionary(fishRows, (c) => number(c, 4))
    result.notebook.spearfish = dictionary(
      (await read('SpearfishingItem', true)).filter((r) => r.rowId >= 20000),
      (c) => number(c, 1),
    )
    const fishIds = new Set(
      [...Object.values(result.notebook.fish), ...Object.values(result.notebook.spearfish)].filter(
        (id) => id > 0 && id < 2000000,
      ),
    )
    const fishingPlaces = new Map<number, number>()
    for (const row of await read('FishingSpot', true)) {
      if (row.rowId >= 10000) continue
      const c = cells(row),
        place = number(c, 23)
      if (!place || place === 950) continue
      fishingPlaces.set(row.rowId, place)
      result.fishing.places[place] = places[place] ?? ''
      result.fishing.placefish[place] = [
        ...new Set([
          ...(result.fishing.placefish[place] ?? []),
          ...c
            .slice(13, 23)
            .map((_, i) => number(c, i + 13))
            .filter(Boolean),
        ]),
      ]
    }
    for (const fish of fishRows) {
      const c = cells(fish),
        spot = number(c, 10)
      const place = fishingPlaces.get(spot)
      if (place && number(c, 4))
        result.fishing.placefish[place] = [...new Set([...(result.fishing.placefish[place] ?? []), number(c, 4)])]
    }
    const partItems = new Map<number, { id: number; name: string }>()
    // Stream Item in small batches, retaining only fish, tackle and submarine part references.
    const itemIds = await this.data.rowIds('Item', language, { signal })
    for (let offset = 0; offset < itemIds.length; offset += 128) {
      for (const row of await this.rows('Item', itemIds.slice(offset, offset + 128), language, signal)) {
        const c = cells(row),
          name = text(c, 9)
        if (fishIds.has(row.rowId)) result.fishing.fish[row.rowId] = name
        if (number(c, 16) === 30) result.fishing.tackle[row.rowId] = name
        if (number(c, 16) === 79 && number(c, 14)) partItems.set(number(c, 14), { id: row.rowId, name })
      }
    }
    for (const row of await read('SubmarineMap', true)) {
      const c = cells(row)
      if (!row.rowId || !text(c, 0)) continue
      result.submarineMap[row.rowId] = {
        name: text(c, 0),
        image: (await this.data.image(iconPath(number(c, 1)), { signal })) ?? '',
        spots: {},
      }
    }
    const explorationNumbers = new Map<number, number>()
    for (const row of await read('SubmarineExploration', true)) {
      const c = cells(row),
        map = result.submarineMap[number(c, 5)]
      if (!map) continue
      const mapId = number(c, 5)
      const index = c[6]?.value === true ? 0 : (explorationNumbers.get(mapId) ?? 0) + 1
      if (index) explorationNumbers.set(mapId, index)
      let location = ''
      for (let n = index; n > 0; n = Math.floor((n - 1) / 26))
        location = String.fromCharCode(65 + ((n - 1) % 26)) + location
      location ||= '0'
      const label = text(c, 1)
      map.spots[location] = {
        location,
        parent: (unlocks as Record<string, Record<string, string | null>>)[number(c, 5)]?.[location] ?? null,
        name: label && label !== location ? label : text(c, 0).replace(new RegExp(`^${location}[\\s　]+`), ''),
        x: number(c, 2),
        y: number(c, 3),
        z: number(c, 4),
        rank: number(c, 8),
        ceruleum: number(c, 9),
        duration: number(c, 10),
        distance: number(c, 11),
        exp: number(c, 12),
      }
    }
    result.submarineParts = dictionary(await read('SubmarinePart'), (c, id) => ({
      name: partItems.get(id)?.name ?? `部件 #${id}`,
      itemId: partItems.get(id)?.id ?? 0,
      slot: number(c, 0),
      rank: number(c, 1),
      components: number(c, 2),
      surveillance: number(c, 3),
      retrieval: number(c, 4),
      speed: number(c, 5),
      range: number(c, 6),
      favor: number(c, 7),
      class: number(c, 8),
      repairMaterials: number(c, 9),
    }))
    result.submarineRanks = dictionary(await read('SubmarineRank'), (c) => ({
      capacity: number(c, 0),
      exp: number(c, 1),
      surveillance: number(c, 2),
      retrieval: number(c, 3),
      speed: number(c, 4),
      range: number(c, 5),
      favor: number(c, 6),
    }))
    const ranks = (await read('TreasureHuntRank')).filter((r) => number(cells(r), 3))
    const spots = await this.subrows(
      'TreasureSpot',
      ranks.map((r) => r.rowId),
      signal,
    )
    const levelIds = [...new Set(spots.flatMap((r) => r.subrows.map((s) => number(s.cells, 0))).filter(Boolean))]
    const levels = new Map((await this.rows('Level', levelIds, 'none', signal)).map((r) => [r.rowId, cells(r)]))
    for (const rank of ranks) {
      const group = spots.find((r) => r.rowId === rank.rowId)
      if (!group) continue
      const rows: GameCatalog['treasures'][string] = []
      const raw: ExplorationSource['treasures'][number] = []
      for (const row of group.subrows) {
        const level = levels.get(number(row.cells, 0))
        if (!level) continue
        const id = number(level, 7),
          map = result.maps[id]
        if (!map) continue
        raw[row.subrowId!] = {
          levelId: number(row.cells, 0),
          territoryId: optionalNumber(level, 9),
          mapId: id,
          world: { x: number(level, 0), y: optionalNumber(level, 1), z: number(level, 2) },
        }
        rows[row.subrowId!] = {
          map: id,
          x: coordinate(number(level, 0), map.offset[0], map.sizeFactor),
          y: coordinate(number(level, 2), map.offset[1], map.sizeFactor),
        }
      }
      result.treasures[number(cells(rank), 3)] = rows
      result.exploration.treasures[number(cells(rank), 3)] = raw
    }
    signal.throwIfAborted()
    return result
  }
}

/** LGB1 instance positions; all offsets are relative to their enclosing tables. */
export function sceneLocations(raw: Uint8Array, wanted: Set<number>) {
  const data = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  const i32 = (offset: number) => data.getInt32(offset, true)
  if (
    new TextDecoder().decode(raw.subarray(0, 4)) !== 'LGB1' ||
    new TextDecoder().decode(raw.subarray(12, 16)) !== 'LGP1' ||
    i32(4) > raw.length
  )
    throw new Error('Unsupported LGB data')
  const offsets = (base: number, count: number) => {
    if (count < 0 || count > raw.length / 4) throw new Error('Invalid LGB count')
    return Array.from({ length: count }, (_, i) => base + i32(base + i * 4))
  }
  const result: { id: number; x: number; z: number }[] = []
  for (const layer of offsets(20 + i32(28), i32(32))) {
    for (const point of offsets(layer + i32(layer + 8), i32(layer + 12))) {
      const id = data.getUint32(point + 4, true)
      if (wanted.has(id))
        result.push({ id, x: data.getFloat32(point + 12, true), z: data.getFloat32(point + 20, true) })
    }
  }
  return result
}
