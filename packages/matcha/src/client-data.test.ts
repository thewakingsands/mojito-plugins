import type { Cell, DataRow, DataService } from '@ffcafe/mojito-plugin-sdk'
import { expect, it, vi } from 'vitest'
import { ClientGameData, sceneLocations } from './client-data.js'

const cell = (value: string | number | boolean): Cell => ({ type: typeof value, value }) as Cell
function row(id: number, length: number, values: Record<number, string | number | boolean>): DataRow {
  return { rowId: id, subrows: [{ subrowId: null, cells: Array.from({ length }, (_, i) => cell(values[i] ?? 0)) }] }
}
function scene(id: number) {
  const raw = new Uint8Array(160),
    view = new DataView(raw.buffer)
  raw.set(new TextEncoder().encode('LGB1'))
  raw.set(new TextEncoder().encode('LGP1'), 12)
  for (const [offset, value] of [
    [4, 160],
    [28, 16],
    [32, 1],
    [36, 4],
    [48, 60],
    [52, 1],
    [100, 4],
    [108, id],
  ])
    view.setInt32(offset, value, true)
  view.setFloat32(116, 100, true)
  view.setFloat32(124, 200, true)
  return raw
}
function fixture() {
  const sheets: Record<string, DataRow[]> = {
    PlaceName: [row(54, 1, { 0: '客户端区域' }), row(969, 1, { 0: '客户端钓场' })],
    TerritoryType: [row(148, 30, { 1: 'ffxiv/test/level/test', 5: 54, 6: 4, 29: 0 })],
    ExVersion: [row(0, 1, { 0: '客户端版本' })],
    ContentType: [row(2, 1, { 0: '迷宫' })],
    ContentRoulette: [row(1, 1, { 0: '随机任务' })],
    ContentFinderCondition: [row(1, 46, { 17: 24, 43: '客户端副本', 45: 2 })],
    Map: [row(4, 13, { 6: 'f1f1/00', 7: 100, 8: 0, 9: 0, 10: 54, 11: 54, 12: 0 })],
    Fate: [row(120, 11, { 0: '客户端危命', 9: 3824577, 10: 5 })],
    DynamicEvent: [row(1, 12, { 5: 8373717, 11: '客户端临界遭遇' })],
    DynamicEventSet: [{ rowId: 1, subrows: [{ subrowId: 0, cells: [cell(1)] }] }],
    RelicNote: [row(1, 30, { 0: 2000, 25: 120 })],
    EventItem: [row(2000, 1, { 0: '客户端预设' })],
    WorldDCGroupType: [row(101, 5, { 0: '陆行鸟', 3: 5 })],
    World: [row(1042, 5, { 0: 'LaNuoXiYa', 1: '拉诺西亚', 4: 101 })],
    FishParameter: [row(1, 11, { 4: 4776, 10: 28 })],
    SpearfishingItem: [row(20001, 2, { 1: 20145 })],
    FishingSpot: [row(28, 24, { 13: 4776, 23: 969 })],
    Item: [
      row(4776, 17, { 9: '客户端鱼', 14: 0, 16: 46 }),
      row(20145, 17, { 9: '客户端刺鱼', 16: 46 }),
      row(2585, 17, { 9: '客户端鱼饵', 16: 30 }),
      row(21792, 17, { 9: '客户端部件', 14: 1, 16: 79 }),
    ],
    SubmarineMap: [row(1, 2, { 0: '客户端海域', 1: 63191 })],
    SubmarineExploration: [
      row(1, 13, {
        0: 'A　客户端探索点',
        1: 'A',
        2: 640,
        3: 880,
        4: 100,
        5: 1,
        8: 1,
        9: 1,
        10: 180,
        11: 10,
        12: 10610,
      }),
    ],
    SubmarinePart: [row(1, 10, { 0: 2, 1: 1, 2: 5, 3: 50, 4: 40, 5: 10, 6: -20, 7: 15, 8: 3, 9: 1 })],
    SubmarineRank: [row(1, 7, { 0: 20, 1: 10000, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5 })],
    TreasureHuntRank: [row(1, 4, { 3: 2001087 })],
    TreasureSpot: [{ rowId: 1, subrows: [{ subrowId: 0, cells: [cell(4512071), cell(0), cell(0)] }] }],
    Level: [row(4512071, 10, { 0: 364.934, 2: 60.0566, 7: 4, 9: 148 })],
  }
  const data = {
    rowIds: vi.fn(async (sheet: string) => (sheets[sheet] ?? []).map((r) => r.rowId)),
    rows: vi.fn(async (sheet: string, ids: number[], _language: string) =>
      (sheets[sheet] ?? []).filter((r) => ids.includes(r.rowId)),
    ),
    image: vi.fn(async () => 'mojito-plugin://runtime/submarine-map'),
    resource: vi.fn(async (path: string) => {
      if (path.endsWith('planevent.lgb')) return scene(3824577)
      if (path.endsWith('planmap.lgb')) return scene(8373717)
      if (path === 'exd/DynamicEventSet.exh') {
        const raw = new Uint8Array(40),
          v = new DataView(raw.buffer)
        v.setUint16(10, 1)
        return raw
      }
      if (path === 'exd/DynamicEventSet_0.exd') {
        const raw = new Uint8Array(40),
          v = new DataView(raw.buffer)
        v.setUint32(8, 8)
        v.setUint32(32, 1)
        return raw
      }
      return null
    }),
  }
  return { sheets, data, client: new ClientGameData(data as unknown as DataService) }
}
it('joins client sheets and scene locations for notifications, fishing, submarine and treasure', async () => {
  const f = fixture(),
    c = await f.client.load('chs', new AbortController().signal)
  expect(c.fates[120]).toEqual({ name: { chs: '客户端危命' }, level: 5, patch: 2, location: 148 })
  expect(c.dynamicEvents[148000]).toEqual({ name: { chs: '客户端临界遭遇' } })
  expect(c.templates).toEqual([{ name: { chs: '客户端预设' }, fate: [120] }])
  expect(c.territories[148]).toEqual({ chs: '客户端区域' })
  expect(c.instances[1]).toEqual({ name: { chs: '客户端副本' }, type: 2, level: 24 })
  expect(c.worlds[1042]).toMatchObject({ name: '拉诺西亚', en: 'LaNuoXiYa', dcName: '陆行鸟' })
  expect(c.notebook).toEqual({ fish: { 1: 4776 }, spearfish: { 20001: 20145 } })
  expect(c.fishing).toEqual({
    fish: { 4776: '客户端鱼', 20145: '客户端刺鱼' },
    tackle: { 2585: '客户端鱼饵' },
    places: { 969: '客户端钓场' },
    placefish: { 969: [4776] },
  })
  expect(c.submarineMap[1]).toMatchObject({
    name: '客户端海域',
    image: 'mojito-plugin://runtime/submarine-map',
    spots: { A: { name: '客户端探索点', parent: '0', duration: 180 } },
  })
  expect(c.submarineParts[1]).toMatchObject({ itemId: 21792, name: '客户端部件', range: -20 })
  expect(c.submarineRanks[1]).toMatchObject({ capacity: 20, exp: 10000, speed: 3 })
  expect(c.treasures[2001087]).toEqual([{ map: 4, x: 28.8, y: 22.7 }])
  expect(f.data.rows.mock.calls.every(([, ids]) => ids.length <= 128)).toBe(true)
})
it('uses the requested client language and streams large Item tables in bounded batches', async () => {
  const f = fixture()
  f.sheets.Item = Array.from({ length: 300 }, (_, i) => row(i + 1, 17, { 9: `Item ${i + 1}`, 16: 30 }))
  const c = await f.client.load('en', new AbortController().signal)
  expect(c.fates[120].name).toEqual({ en: '客户端危命' })
  expect(Object.keys(c.fishing.tackle)).toHaveLength(300)
  expect(f.data.rows.mock.calls.filter(([s]) => s === 'Item').map(([, ids]) => ids.length)).toEqual([128, 128, 44])
  expect(f.data.rows.mock.calls.find(([s]) => s === 'PlaceName')?.[2]).toBe('en')
})
it('rejects invalid layouts and canceled loads instead of returning embedded data', async () => {
  const f = fixture(),
    controller = new AbortController()
  controller.abort()
  await expect(f.client.load('chs', controller.signal)).rejects.toThrow()
  f.sheets.Fate[0].subrows[0].cells[10] = cell('unsupported')
  await expect(f.client.load('chs', new AbortController().signal)).rejects.toThrow('numeric column')
})
it('reads matching LGB instance positions and rejects truncated resource offsets', () => {
  expect(sceneLocations(scene(7), new Set([7]))).toEqual([{ id: 7, x: 100, z: 200 }])
  expect(sceneLocations(scene(7), new Set([8]))).toEqual([])
  expect(() => sceneLocations(scene(7).subarray(0, 120), new Set([7]))).toThrow()
})

it('keeps submarine route keys independent of localized names and supports the international DC layout', async () => {
  const f = fixture()
  f.sheets.WorldDCGroupType = [row(101, 3, { 0: 'Elemental', 1: 1, 2: false })]
  f.sheets.World[0] = row(1042, 6, { 0: 'Ravana', 1: 'Ravana', 4: 101, 5: true })
  f.sheets.SubmarineExploration[0].subrows[0].cells[0] = cell('the Ivory Shoals')
  f.sheets.SubmarineExploration[0].subrows[0].cells[1] = cell('Ivory Shoals')
  const c = await f.client.load('en', new AbortController().signal)
  expect(c.submarineMap[1].spots.A).toMatchObject({ name: 'Ivory Shoals', parent: '0', location: 'A' })
  expect(c.worlds[1042]).toMatchObject({ dcName: 'Elemental', region: 'global' })
})

it('retains raw treasure height separately without changing the legacy 2D catalog', async () => {
  const f = fixture()
  f.sheets.Level[0].subrows[0].cells[1] = cell(-24.5)
  const c = await f.client.load('en', new AbortController().signal)
  expect(c.treasures[2001087]).toEqual([{ map: 4, x: 28.8, y: 22.7 }])
  expect(c.exploration.treasures[2001087][0]).toEqual({
    levelId: 4512071,
    territoryId: 148,
    mapId: 4,
    world: { x: 364.934, y: -24.5, z: 60.0566 },
  })
  expect(c.exploration.fatePositions[120]).toEqual({ territoryId: 148, mapId: 4, x: 100, z: 200 })
  f.sheets.Level[0].subrows[0].cells[1] = cell('missing')
  const withoutHeight = await f.client.load('en', new AbortController().signal)
  expect(withoutHeight.treasures).toEqual(c.treasures)
  expect(withoutHeight.exploration.treasures[2001087][0].world.y).toBeNull()
})
it('retains zero height and leaves missing FATE scene positions unknown', async () => {
  const f = fixture()
  f.data.resource.mockImplementation(async () => null)
  // Avoid unrelated subrow resource reads in this missing-scene fixture.
  f.sheets.DynamicEventSet = []
  const original = f.data.resource.getMockImplementation()
  f.data.resource.mockImplementation(async (path: string) => {
    if (path === 'exd/DynamicEventSet.exh') return new Uint8Array(32)
    return original!(path)
  })
  const c = await f.client.load('en', new AbortController().signal)
  expect(c.exploration.treasures[2001087][0].world.y).toBe(0)
  expect(c.exploration.fatePositions[120]).toBeUndefined()
  expect(c.fates[120].location).toBe(0)
})
