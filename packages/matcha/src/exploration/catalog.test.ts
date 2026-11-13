import type { Cell, DataRow, DataService } from '@ffcafe/mojito-plugin-sdk'
import { expect, it, vi } from 'vitest'
import { emptyCatalog } from '../client-data.js'
import { loadExplorationCatalog } from './catalog.js'

const row = (rowId: number, values: (number | string | boolean)[]): DataRow => ({
  rowId,
  subrows: [{ subrowId: null, cells: values.map((value) => ({ type: typeof value, value }) as Cell) }],
})
function fixture() {
  const base = emptyCatalog()
  base.maps[4] = { name: 'Synthetic island', sizeFactor: 100, offset: [0, 0] }
  base.exploration.maps[4] = { resource: 'test/00', territoryId: 732, isEvent: false }
  base.exploration.territories[732] = { mapId: 4, weatherRateId: 1 }
  base.treasures[88] = [{ map: 4, x: 21.5, y: 21.5 }]
  base.exploration.treasures[88] = [{ mapId: 4, levelId: 123, territoryId: 732, world: { x: 0, y: -100, z: 0 } }]
  base.fates = {
    120: { name: { en: 'Observed island NM' }, location: 732, level: 1, patch: 4 },
    121: { name: { en: 'Missing static point' }, location: 0, level: 1, patch: 4 },
    122: { name: { en: 'Other island' }, location: 763, level: 1, patch: 4 },
  }
  base.exploration.fatePositions[120] = { territoryId: 732, mapId: 4, x: 0, z: 0 }
  const sheets: Record<string, DataRow[]> = {
    TerritoryTypeTransient: [row(732, [0])],
    BNpcName: [
      row(200, ['Synthetic B']),
      row(201, ['Synthetic SS']),
      row(202, ['Synthetic minion']),
      row(203, ['Future rank']),
    ],
    NotoriousMonster: [row(1, [100, 1, 200]), row(2, [10422, 3, 201]), row(3, [13938, 3, 202]), row(4, [101, 99, 203])],
    Weather: [row(4, [0, 'Fog'])],
    WeatherRate: [row(1, [4, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])],
  }
  const data = {
    rowIds: vi.fn(async (name: string) => sheets[name]?.map((r) => r.rowId) ?? []),
    rows: vi.fn(
      async (name: string, ids: number[], _language: string) =>
        sheets[name]?.filter((r) => ids.includes(r.rowId)) ?? [],
    ),
  }
  const load = (signal = new AbortController().signal, language = 'en') =>
    loadExplorationCatalog(data as unknown as DataService, base, language, signal)
  return { base, sheets, data, load }
}
it('joins client-only names, raw heights and SS exceptions without inventing static positions', async () => {
  const f = fixture(),
    c = await f.load()
  expect(c.targets[88][0]).toMatchObject({ z: -1, zStatus: 'known', x: 21.5, world: { y: -100 } })
  expect(c.hunts.map((h) => h.rank)).toEqual(['B', 'SS', 'SS', null])
  expect(c.eureka[732].fates).toEqual([
    { id: 120, name: 'Observed island NM', position: { mapId: 4, x: 21.5, y: 21.5 } },
    { id: 121, name: 'Missing static point', position: null },
  ])
  expect(c.eureka[732].weatherRates).toEqual([{ weatherId: 4, rate: 100 }])
  expect(c.eureka[732].weatherNames.get(4)).toBe('Fog')
})
it('keeps optional height and hunt failures separate from 2D and weather data', async () => {
  const f = fixture()
  f.sheets.TerritoryTypeTransient = [row(732, ['bad'])]
  f.sheets.NotoriousMonster = [row(1, ['bad', 1, 200])]
  const c = await f.load()
  expect(c.heightAvailable).toBe(false)
  expect(c.huntsAvailable).toBe(false)
  expect(c.targets[88][0]).toMatchObject({ x: 21.5, y: 21.5, z: null, zStatus: 'unavailable' })
  expect(c.eureka[732].weatherRates).toEqual([{ weatherId: 4, rate: 100 }])
})
it('honors the hidden Z sentinel while preserving raw height', async () => {
  const f = fixture()
  f.sheets.TerritoryTypeTransient = [row(732, [-10000])]
  expect((await f.load()).targets[88][0]).toMatchObject({ z: null, zStatus: 'hidden', world: { y: -100 } })
  f.sheets.TerritoryTypeTransient = [row(732, [-100])]
  expect((await f.load()).targets[88][0]).toMatchObject({ z: 0, zStatus: 'known' })
})
it('merges equivalent map rows and rejects real alternate projections only in the affected territory', async () => {
  const f = fixture()
  f.base.maps[5] = { ...f.base.maps[4] }
  f.base.exploration.maps[5] = { ...f.base.exploration.maps[4] }
  expect((await f.load()).territoryMaps[732]).toBe(4)
  f.base.exploration.maps[5].isEvent = true
  f.base.exploration.maps[5].resource = 'test/event'
  expect((await f.load()).territoryMaps[732]).toBe(4)
  f.base.exploration.maps[5].isEvent = false
  const c = await f.load()
  expect(c.territoryMaps[732]).toBeNull()
  expect(c.mapIssues[732]).toBeTruthy()
  expect(c.eureka[732].fates[0].position).toBeNull()
})
it('does not cache results across client languages and discards canceled reads', async () => {
  const f = fixture()
  await f.load(undefined, 'ja')
  expect(f.data.rows.mock.calls.find(([name]) => name === 'BNpcName')?.[2]).toBe('ja')
  const controller = new AbortController()
  f.data.rows.mockImplementation(async () => {
    controller.abort()
    return []
  })
  await expect(f.load(controller.signal)).rejects.toThrow()
})

it('reads names only for client hunt references, isolating unrelated BNpc rows', async () => {
  const f = fixture()
  f.sheets.BNpcName.push(row(9999, [0]))
  expect((await f.load()).huntsAvailable).toBe(true)
  expect(f.data.rows.mock.calls.find(([name]) => name === 'BNpcName')?.[1]).toEqual([200, 201, 202, 203])
})
