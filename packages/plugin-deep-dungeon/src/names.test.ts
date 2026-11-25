import type { DataRow } from '@ffcafe/mojito-plugin-sdk'
import { expect, it, vi } from 'vitest'
import { names } from './names.js'
import { fixtureHost } from './test-host.js'

it('passes the session language, reads the supplied synthetic column, and leaves missing names to the caller', async () => {
  const host = fixtureHost()
  host.ctx.data.rows = vi.fn(
    async (): Promise<DataRow[]> => [
      {
        rowId: 910001,
        subrows: [
          {
            subrowId: null,
            cells: [
              { type: 'number', value: 0 },
              { type: 'boolean', value: false },
              { type: 'string', value: '合成名称' },
            ],
          },
        ],
      },
      {
        rowId: 910002,
        subrows: [
          {
            subrowId: null,
            cells: [
              { type: 'string', value: 'Wrong column' },
              { type: 'string', value: '' },
              { type: 'number', value: 12 },
            ],
          },
        ],
      },
      {
        rowId: 910003,
        subrows: [
          {
            subrowId: null,
            cells: [
              { type: 'string', value: 'Ignored' },
              { type: 'string', value: '' },
              { type: 'string', value: '  ' },
            ],
          },
        ],
      },
    ],
  )
  expect(await names(host.ctx, [910001, 910002, 910003, 910004], 2)).toEqual({
    language: 'chs',
    names: { 910001: '合成名称' },
  })
  expect(host.ctx.data.rows).toHaveBeenCalledWith('BNpcName', [910001, 910002, 910003, 910004], 'chs')
})
it('does not guess a language or unverified column, and falls back on a read error', async () => {
  const host = fixtureHost()
  host.ctx.data.rows = vi.fn(async () => {
    throw new Error('No page')
  })
  expect(await names(host.ctx, [910001], null)).toEqual({ language: 'chs', names: {} })
  expect(host.ctx.data.rows).not.toHaveBeenCalled()
  host.session({ dataLanguage: null })
  expect(await names(host.ctx, [910001], 2)).toEqual({ language: null, names: {} })
  expect(host.ctx.data.rows).not.toHaveBeenCalled()
  host.session({ dataLanguage: 'en' })
  expect(await names(host.ctx, [910001], 2)).toEqual({ language: 'en', names: {} })
  expect(host.ctx.data.rows).toHaveBeenCalledTimes(1)
})
it('returns the language captured for this request even if the session changes', async () => {
  const host = fixtureHost()
  const get = vi.spyOn(host.ctx.session, 'get')
  host.ctx.data.rows = async () => {
    host.session({ dataLanguage: 'en' })
    return [{ rowId: 910001, subrows: [{ subrowId: null, cells: [{ type: 'string', value: '旧语言' }] }] }]
  }
  expect(await names(host.ctx, [910001], 0)).toEqual({ language: 'chs', names: { 910001: '旧语言' } })
  expect(get).toHaveBeenCalledTimes(1)
})
