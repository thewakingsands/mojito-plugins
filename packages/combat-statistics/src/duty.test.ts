import type { Cell, DataService } from '@ffcafe/mojito-plugin-sdk'
import { expect, it } from 'vitest'
import { dutyName } from './duty.js'

/** Game data of the territory 1001, which holds the duty 77, and of the city 128 without a duty */
function data(overrides: { territory?: Cell; name?: Cell; backlink?: number; fail?: string } = {}) {
  const sheets: Record<string, Record<number, Cell[]>> = {
    TerritoryType: { 1001: [], 128: [] },
    ContentFinderCondition: { 77: [] },
  }
  sheets.TerritoryType[1001][10] = overrides.territory ?? { type: 'number', value: 77 }
  sheets.TerritoryType[128][10] = { type: 'number', value: 0 }
  sheets.ContentFinderCondition[77][1] = { type: 'number', value: overrides.backlink ?? 1001 }
  sheets.ContentFinderCondition[77][43] = overrides.name ?? { type: 'string', value: '海德林歼灭战' }
  return {
    rows: async (sheet: string, ids: number[], language: string) => {
      if (sheet === overrides.fail) throw new Error('读取失败')
      if ((sheet === 'TerritoryType') !== (language === 'none'))
        throw new Error(`${sheet} does not support ${language}`)
      return ids.map((rowId) => ({ rowId, subrows: [{ subrowId: null, cells: sheets[sheet][rowId] }] }))
    },
  } as unknown as DataService
}

it('names the duty a territory holds', async () => {
  expect(await dutyName(data(), 1001, 'cn')).toBe('海德林歼灭战')
})
it('gives no name to a territory without a duty', async () => {
  expect(await dutyName(data(), 128, 'cn')).toBeNull()
})
it('gives no name when a read fails or the name is empty', async () => {
  expect(await dutyName(data({ fail: 'TerritoryType' }), 1001, 'cn')).toBeNull()
  expect(await dutyName(data({ fail: 'ContentFinderCondition' }), 1001, 'cn')).toBeNull()
  expect(await dutyName(data({ name: { type: 'string', value: '' } }), 1001, 'cn')).toBeNull()
  expect(await dutyName(data({ territory: { type: 'string', value: '' } }), 1001, 'cn')).toBeNull()
})
it('gives no name when the duty does not point back to the territory', async () => {
  expect(await dutyName(data({ backlink: 1002 }), 1001, 'cn')).toBeNull()
})
