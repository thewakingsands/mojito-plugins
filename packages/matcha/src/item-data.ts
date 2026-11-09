import type { Cell, DataService } from '@ffcafe/mojito-plugin-sdk'

// Item EXH declaration order, verified against the CN 2026.10.06 client.
const columns = { name: 9, icon: 10, level: 11, slots: 86, advanced: 87 }
const number = (cells: Cell[], index: number) => {
  const cell = cells[index]
  if (cell?.type !== 'number' || !Number.isInteger(cell.value) || cell.value < 0)
    throw new Error('Unsupported Item row layout')
  return cell.value
}

export async function readClientItems(
  data: Pick<DataService, 'rows' | 'image'>,
  ids: number[],
  language: string,
  signal: AbortSignal,
) {
  const rows = await data.rows('Item', ids, language, { signal })
  return Promise.all(
    rows.map(async ({ rowId, subrows }) => {
      const cells = subrows[0]?.cells ?? []
      const name = cells[columns.name],
        advanced = cells[columns.advanced]
      if (name?.type !== 'string' || advanced?.type !== 'boolean') throw new Error('Unsupported Item row layout')
      const icon = number(cells, columns.icon)
      const group = String(Math.floor(icon / 1000) * 1000).padStart(6, '0')
      return {
        id: rowId,
        n: { [language]: name.value },
        i: icon ? ((await data.image(`ui/icon/${group}/${String(icon).padStart(6, '0')}.tex`, { signal })) ?? '') : '',
        s: number(cells, columns.slots),
        a: advanced.value ? 1 : 0,
        l: number(cells, columns.level),
        local: true,
      }
    }),
  )
}
