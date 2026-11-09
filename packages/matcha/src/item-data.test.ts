import type { Cell, DataService } from '@ffcafe/mojito-plugin-sdk'
import { expect, it, vi } from 'vitest'
import { readClientItems } from './item-data.js'

it('reads item metadata and its icon from the current client without an HTTP service', async () => {
  const cells: Cell[] = Array.from({ length: 91 }, () => ({ type: 'number', value: 0 }))
  cells[9] = { type: 'string', value: '本地装备' }
  cells[10] = { type: 'number', value: 31001 }
  cells[11] = { type: 'number', value: 740 }
  cells[86] = { type: 'number', value: 2 }
  cells[87] = { type: 'boolean', value: true }
  const data = {
    rows: vi.fn(async () => [{ rowId: 42, subrows: [{ subrowId: null, cells }] }]),
    image: vi.fn(async () => 'mojito-plugin://runtime/client-image/42'),
  } as unknown as Pick<DataService, 'rows' | 'image'>
  const signal = new AbortController().signal
  expect(await readClientItems(data, [42], 'chs', signal)).toEqual([
    {
      id: 42,
      n: { chs: '本地装备' },
      i: 'mojito-plugin://runtime/client-image/42',
      s: 2,
      a: 1,
      l: 740,
      local: true,
    },
  ])
  expect(data.rows).toHaveBeenCalledWith('Item', [42], 'chs', { signal })
  expect(data.image).toHaveBeenCalledWith('ui/icon/031000/031001.tex', { signal })
  cells[87] = { type: 'number', value: 1 }
  await expect(readClientItems(data, [42], 'chs', signal)).rejects.toThrow('Unsupported Item row layout')
})
