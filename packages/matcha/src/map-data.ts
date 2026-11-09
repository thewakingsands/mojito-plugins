// Copyright (c) FFCafe. Licensed under AGPL-3.0-only.
import type { Cell, DataRow, DataService } from '@ffcafe/mojito-plugin-sdk'
import { pluginError } from '@ffcafe/mojito-plugin-sdk/errors'

export interface MapInfo {
  rowId: number
  id: string
  sizeFactor: number
  offsetX?: number
  offsetY?: number
  placeName?: string
  placeNameSub?: string
  marker: number
}
export interface MapMarker {
  x: number
  y: number
  icon?: number
  name?: string
  orientation?: number
  type?: number
  dataType?: number
  dataKey?: string
}
export interface MapRegion {
  placeNameRegion: string
  maps: { rowId: number; placeName: string; placeNameSub?: string }[]
}
type LocalMap = MapInfo & { region: string }
// EXH column order follows SaintCoinach 0b22b78, not EXDSchema's offset-sorted fields.
const mapColumns = { marker: 5, id: 6, size: 7, x: 8, y: 9, region: 10, place: 11, sub: 12 }
const markerColumns = { x: 0, y: 1, icon: 2, name: 3, orientation: 4, type: 6, dataType: 7, dataKey: 8 }
const compact = <T extends object>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== '')) as T
function number(cells: Cell[], index: number): number {
  const cell = cells[index]
  if (cell?.type !== 'number' || !Number.isFinite(cell.value)) throw new Error(`Unexpected numeric map column ${index}`)
  return cell.value
}
function reference(cells: Cell[], index: number): number {
  const value = number(cells, index)
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new Error(`Unexpected map reference ${index}`)
  return value
}
function text(cells: Cell[], index: number): string {
  const cell = cells[index]
  if (cell?.type !== 'string') throw new Error(`Unexpected text map column ${index}`)
  return cell.value
}

export class ClientMapData {
  private index?: Promise<Map<number, LocalMap>>
  private readonly names = new Map<number, Promise<string>>()
  private readonly markerGroups = new Map<number, Promise<MapMarker[]>>()
  private revision = 0
  get generation(): number {
    return this.revision
  }
  constructor(
    private readonly data: Pick<DataService, 'rowIds' | 'rows'>,
    private readonly batchSize: number,
    private readonly authorized: () => boolean,
    private readonly signal: () => AbortSignal,
  ) {}
  reset(): void {
    this.revision++
    this.index = undefined
    this.names.clear()
    this.markerGroups.clear()
  }
  private begin(): () => void {
    const generation = this.revision,
      signal = this.signal()
    const fresh = () => {
      if (!this.authorized()) throw pluginError('permission_denied')
      if (generation !== this.revision) throw pluginError('stale_session')
      signal.throwIfAborted()
    }
    fresh()
    return fresh
  }
  private async rows(sheet: string, ids: number[], language: string, fresh: () => void): Promise<DataRow[]> {
    const result: DataRow[] = []
    const signal = this.signal()
    for (let offset = 0; offset < ids.length; offset += this.batchSize) {
      fresh()
      result.push(...(await this.data.rows(sheet, ids.slice(offset, offset + this.batchSize), language, { signal })))
      fresh()
    }
    return result
  }
  private async placeNames(ids: number[], fresh: () => void): Promise<void> {
    const missing = [...new Set(ids)].filter((id) => id !== 0 && !this.names.has(id))
    if (missing.length) {
      const result = this.rows('PlaceName', missing, 'chs', fresh).then(
        (rows) => new Map(rows.map((row) => [row.rowId, text(row.subrows[0]?.cells ?? [], 0)])),
      )
      for (const id of missing) {
        const pending = result
          .then((names) => {
            if (!names.has(id)) throw new Error(`PlaceName ${id} was not found`)
            return names.get(id)!
          })
          .catch((error) => {
            if (this.names.get(id) === pending) this.names.delete(id)
            throw error
          })
        this.names.set(id, pending)
      }
    }
    await Promise.all(ids.filter((id) => id !== 0).map((id) => this.names.get(id)))
    fresh()
  }
  private name(id: number): Promise<string> {
    return id === 0 ? Promise.resolve('') : this.names.get(id)!
  }
  private async maps(fresh: () => void): Promise<Map<number, LocalMap>> {
    if (!this.index) {
      const pending = this.loadMaps(fresh).catch((error) => {
        if (this.index === pending) this.index = undefined
        throw error
      })
      this.index = pending
    }
    const maps = await this.index
    fresh()
    return maps
  }
  private async loadMaps(fresh: () => void): Promise<Map<number, LocalMap>> {
    const ids = await this.data.rowIds('Map', 'none', { signal: this.signal() })
    fresh()
    const rows = await this.rows('Map', ids, 'none', fresh)
    await this.placeNames(
      rows.flatMap((row) =>
        [mapColumns.region, mapColumns.place, mapColumns.sub].map((index) =>
          reference(row.subrows[0]?.cells ?? [], index),
        ),
      ),
      fresh,
    )
    const result = new Map<number, LocalMap>()
    for (const row of rows) {
      const cells = row.subrows[0]?.cells ?? [],
        id = text(cells, mapColumns.id)
      if (!id) continue
      if (!/^[a-zA-Z0-9_-]+\/\d{2}$/.test(id)) throw new Error(`Unexpected Map ${row.rowId} ID`)
      result.set(
        row.rowId,
        compact({
          rowId: row.rowId,
          id,
          sizeFactor: number(cells, mapColumns.size),
          marker: reference(cells, mapColumns.marker),
          offsetX: number(cells, mapColumns.x) || undefined,
          offsetY: number(cells, mapColumns.y) || undefined,
          region: await this.name(reference(cells, mapColumns.region)),
          placeName: await this.name(reference(cells, mapColumns.place)),
          placeNameSub: await this.name(reference(cells, mapColumns.sub)),
        }),
      )
    }
    fresh()
    return result
  }
  async getMap(rowId: number): Promise<MapInfo> {
    const fresh = this.begin(),
      value = (await this.maps(fresh)).get(rowId)
    if (!value) throw new Error(`Map ${rowId} was not found`)
    const { region: _, ...map } = value
    return map
  }
  async getMapKeyById(id: string): Promise<number> {
    const fresh = this.begin()
    const found = [...(await this.maps(fresh)).values()].find((map) => map.id === id)
    if (!found) throw new Error(`Map ${id} was not found`)
    return found.rowId
  }
  async getRegion(): Promise<MapRegion[]> {
    const fresh = this.begin(),
      regions = new Map<string, MapRegion>()
    for (const map of (await this.maps(fresh)).values()) {
      if (!map.region || !map.placeName || [487, 534].includes(map.rowId)) continue
      if (!regions.has(map.region)) regions.set(map.region, { placeNameRegion: map.region, maps: [] })
      regions
        .get(map.region)!
        .maps.push(compact({ rowId: map.rowId, placeName: map.placeName, placeNameSub: map.placeNameSub }))
    }
    const priority = (name: string) => {
      const index = ['艾欧泽亚', '东方地域', '诺弗兰特'].indexOf(name)
      return index >= 0 ? index : name === '？？？？' ? 4 : 3
    }
    return [...regions.values()].sort((a, b) => priority(a.placeNameRegion) - priority(b.placeNameRegion))
  }
  async getMapMarkers(rowId: number): Promise<MapMarker[]> {
    const fresh = this.begin(),
      map = await this.getMap(rowId)
    fresh()
    if (!map.marker) return []
    if (!this.markerGroups.has(map.marker)) {
      const pending = this.loadMarkers(map.marker, fresh).catch((error) => {
        if (this.markerGroups.get(map.marker) === pending) this.markerGroups.delete(map.marker)
        throw error
      })
      this.markerGroups.set(map.marker, pending)
    }
    const markers = await this.markerGroups.get(map.marker)!
    fresh()
    return markers
  }
  private async loadMarkers(group: number, fresh: () => void): Promise<MapMarker[]> {
    const row = (await this.rows('MapMarker', [group], 'none', fresh))[0]
    if (!row || row.rowId !== group) throw new Error(`MapMarker ${group} was not found`)
    const columns = markerColumns
    const ids = row.subrows.flatMap(({ cells }) => [
      reference(cells, columns.name),
      ...(reference(cells, columns.dataType) === 4 ? [reference(cells, columns.dataKey)] : []),
    ])
    await this.placeNames(ids, fresh)
    const maps = await this.maps(fresh),
      result: MapMarker[] = []
    for (const { cells } of row.subrows) {
      const key = reference(cells, columns.dataKey),
        dataType = reference(cells, columns.dataType)
      let dataKey = key ? String(key) : undefined
      if (dataType === 1) {
        if (key && !maps.has(key)) throw new Error(`Map ${key} was not found`)
        dataKey = maps.get(key)?.id
      } else if (dataType === 4) dataKey = await this.name(key)
      const marker = compact({
        x: number(cells, columns.x),
        y: number(cells, columns.y),
        icon: reference(cells, columns.icon) || undefined,
        name: await this.name(reference(cells, columns.name)),
        orientation: reference(cells, columns.orientation) || undefined,
        type: reference(cells, columns.type) || undefined,
        dataType: dataType || undefined,
        dataKey,
      })
      if (
        marker.x ||
        marker.y ||
        marker.icon ||
        marker.name ||
        marker.orientation ||
        marker.type ||
        marker.dataType ||
        marker.dataKey
      )
        result.push(marker)
    }
    fresh()
    return result
  }
}
