import type { Cell, DataRow, DataService } from '@ffcafe/mojito-plugin-sdk'
import { expect, it, vi } from 'vitest'
import { ClientMapData } from './map-data.js'

const n = (value: number): Cell => ({ type: 'number', value })
const s = (value: string): Cell => ({ type: 'string', value })
function map(rowId: number, id: string, marker = 99): DataRow {
  const cells: Cell[] = Array.from({ length: 13 }, () => n(0))
  cells[5] = n(marker)
  cells[6] = s(id)
  cells[7] = n(100)
  cells[8] = n(-5)
  cells[9] = n(7)
  cells[10] = n(1)
  cells[11] = n(2)
  cells[12] = n(0)
  return { rowId, subrows: [{ subrowId: null, cells }] }
}
function fixture() {
  let allowed = true,
    controller = new AbortController()
  const maps = [map(0, ''), map(100, 'test/00'), map(200, 'other/01', 0), map(487, 'hidden/00', 0)]
  const markers = {
    rowId: 99,
    subrows: [
      { subrowId: 0, cells: [10, 20, 60003, 3, 1, 0, 0, 1, 200].map(n) },
      { subrowId: 4, cells: [0, 0, 0, 0, 4, 0, 0, 4, 4].map(n) },
      { subrowId: 9, cells: Array.from({ length: 9 }, () => n(0)) },
    ],
  }
  const names = ['', '艾欧泽亚', '本地地图', '入口', '提示文本']
  const data = {
    rowIds: vi.fn(async () => maps.map((row) => row.rowId)),
    rows: vi.fn(async (sheet: string, ids: number[], language: string): Promise<DataRow[]> => {
      expect(ids.length).toBeLessThanOrEqual(2)
      expect(language).toBe(sheet === 'PlaceName' ? 'chs' : 'none')
      if (sheet === 'Map') return ids.map((id) => maps.find((row) => row.rowId === id)!)
      if (sheet === 'MapMarker') return [markers]
      return ids.map((id) => ({ rowId: id, subrows: [{ subrowId: null, cells: [s(names[id])] }] }))
    }),
  }
  const client = new ClientMapData(
    data as unknown as DataService,
    2,
    () => allowed,
    () => controller.signal,
  )
  return {
    data,
    client,
    maps,
    markers,
    deny: () => {
      allowed = false
    },
    reset: () => {
      controller.abort()
      controller = new AbortController()
      client.reset()
    },
  }
}

it('enumerates actual map IDs, batches cells and shares local names without HTTP', async () => {
  const { data, client } = fixture()
  const [regions, map] = await Promise.all([client.getRegion(), client.getMap(100)])
  expect(map).toEqual({
    rowId: 100,
    id: 'test/00',
    marker: 99,
    sizeFactor: 100,
    offsetX: -5,
    offsetY: 7,
    placeName: '本地地图',
  })
  expect(regions).toEqual([
    {
      placeNameRegion: '艾欧泽亚',
      maps: [
        { rowId: 100, placeName: '本地地图' },
        { rowId: 200, placeName: '本地地图' },
      ],
    },
  ])
  expect((await client.getMap(487)).id).toBe('hidden/00')
  expect(await client.getMapKeyById('other/01')).toBe(200)
  await expect(client.getMap(1)).rejects.toThrow('not found')
  expect(data.rowIds).toHaveBeenCalledOnce()
  expect(data.rows.mock.calls.filter(([sheet]) => sheet === 'MapMarker')).toHaveLength(0)
})

it('loads exact marker subrows lazily, resolves polymorphic links and preserves raw order', async () => {
  const { data, client } = fixture()
  expect(await client.getMapMarkers(100)).toEqual([
    { x: 10, y: 20, icon: 60003, name: '入口', orientation: 1, dataType: 1, dataKey: 'other/01' },
    { x: 0, y: 0, orientation: 4, dataType: 4, dataKey: '提示文本' },
  ])
  await client.getMapMarkers(100)
  expect(data.rows.mock.calls.filter(([sheet]) => sheet === 'MapMarker')).toHaveLength(1)
  expect(await client.getMapMarkers(200)).toEqual([])
})

it('rejects denied cached queries and discards reads from an old session', async () => {
  const f = fixture()
  await f.client.getRegion()
  f.deny()
  await expect(f.client.getMap(100)).rejects.toMatchObject({ code: 'permission_denied' })
  const h = fixture()
  let resolve!: (ids: number[]) => void
  h.data.rowIds.mockImplementationOnce(
    () =>
      new Promise<number[]>((r) => {
        resolve = r
      }),
  )
  const old = h.client.getMap(100)
  h.reset()
  resolve([100])
  await expect(old).rejects.toMatchObject({ code: 'stale_session' })
  expect((await h.client.getMap(100)).id).toBe('test/00')
  expect(h.data.rowIds).toHaveBeenCalledTimes(2)
})

it('retries failed marker reads and rejects unsupported field layouts instead of guessing', async () => {
  const f = fixture()
  await f.client.getRegion()
  f.data.rows.mockRejectedValueOnce(new Error('read failed'))
  await expect(f.client.getMapMarkers(100)).rejects.toThrow('read failed')
  expect(await f.client.getMapMarkers(100)).toHaveLength(2)
  const broken = fixture()
  broken.maps[1].subrows[0].cells[7] = s('wrong layout')
  await expect(broken.client.getMap(100)).rejects.toThrow('numeric map column')
})
