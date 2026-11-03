import { gunzipSync } from 'fflate'
import { parquetReadObjects } from 'hyparquet'
import { describe, expect, it } from 'vitest'
import {
  buildFile,
  type Cell,
  type ColumnSpec,
  decodeColumns,
  encodeRowGroup,
  FORMAT,
  FORMAT_KEY,
  ParquetFormatError,
  parseFile,
} from './parquet.js'

const columns: ColumnSpec[] = [
  { name: 'note', type: 'BYTE_ARRAY', utf8: true, required: false, encoding: 'PLAIN', codec: 'UNCOMPRESSED' },
  { name: 'kind', type: 'BYTE_ARRAY', utf8: true, required: true, encoding: 'RLE_DICTIONARY', codec: 'GZIP' },
  { name: 't', type: 'INT64', utf8: false, required: true, encoding: 'DELTA_BINARY_PACKED', codec: 'GZIP' },
  { name: 'n', type: 'INT32', utf8: false, required: false, encoding: 'DELTA_BINARY_PACKED', codec: 'GZIP' },
  { name: 'plain', type: 'INT32', utf8: false, required: false, encoding: 'PLAIN', codec: 'GZIP' },
  { name: 'flag', type: 'BOOLEAN', utf8: false, required: false, encoding: 'PLAIN', codec: 'GZIP' },
  { name: 'amount', type: 'DOUBLE', utf8: false, required: false, encoding: 'BYTE_STREAM_SPLIT', codec: 'GZIP' },
  { name: 'x', type: 'FLOAT', utf8: false, required: false, encoding: 'BYTE_STREAM_SPLIT', codec: 'GZIP' },
  { name: 'empty', type: 'INT64', utf8: false, required: false, encoding: 'DELTA_BINARY_PACKED', codec: 'GZIP' },
  { name: 'tag', type: 'BYTE_ARRAY', utf8: true, required: false, encoding: 'RLE_DICTIONARY', codec: 'GZIP' },
]
const kv = { [FORMAT_KEY]: FORMAT }
const decompressors = { GZIP: (input: Uint8Array) => gunzipSync(input) }

function group(start: number, count: number) {
  const values: Cell[][] = columns.map(() => [])
  for (let i = start; i < start + count; i++) {
    const row: Cell[] = [
      i % 3 === 0 ? `{"note":"副本 ${i}"}` : null,
      i % 2 ? 'action' : 'pos',
      1_793_016_421_120 + i * 250,
      i % 4 === 0 ? null : i - 50,
      i % 5 === 0 ? null : i * 7,
      i % 3 === 0 ? null : i % 2 === 0,
      i % 6 === 0 ? null : i * 1.5 + 0.25,
      i % 7 === 0 ? null : Math.fround(i / 3),
      null,
      i % 2 ? null : ['exact', 'estimated'][i % 4 === 0 ? 0 : 1],
    ]
    row.forEach((cell, index) => {
      values[index].push(cell)
    })
  }
  return { encoded: encodeRowGroup(columns, values), values }
}
const rows = (values: Cell[][]) =>
  values[0].map((_, r) => Object.fromEntries(columns.map((column, c) => [column.name, values[c][r]])))
async function readAll(bytes: Uint8Array) {
  const read = await parquetReadObjects({ file: bytes.slice().buffer, compressors: decompressors })
  return read.map((row) =>
    Object.fromEntries(
      columns.map(({ name }) => {
        const cell = row[name]
        return [name, typeof cell === 'bigint' ? Number(cell) : (cell ?? null)]
      }),
    ),
  )
}

describe('parquet', () => {
  it('round-trips every type and encoding, including nulls and an all-null column', async () => {
    const first = group(0, 40)
    const file = buildFile(columns, [first.encoded], kv, 'test')
    expect(await readAll(file)).toEqual(rows(first.values))
    const parsed = parseFile(file, columns)
    expect(parsed.kv[FORMAT_KEY]).toBe(FORMAT)
    expect(
      await decodeColumns(
        parsed,
        0,
        columns.map((column) => column.name),
      ),
    ).toEqual(first.values)
  })
  it('keeps uncompressed UTF-8 notes readable in the file bytes', () => {
    const file = buildFile(columns, [group(0, 10).encoded], kv, 'test')
    const text = new TextDecoder().decode(file)
    expect(text).toContain('{"note":"副本 3"}')
  })
  it('appends a row group without changing the bytes of the earlier one', async () => {
    const first = group(0, 30),
      second = group(30, 30)
    const a = buildFile(columns, [first.encoded], kv, 'test')
    const parsed = parseFile(a)
    const b = buildFile(columns, [...parsed.groups, second.encoded], kv, 'test')
    const length = first.encoded.bytes.length
    expect(b.slice(4, 4 + length)).toEqual(a.slice(4, 4 + length))
    expect(await readAll(b)).toEqual([...rows(first.values), ...rows(second.values)])
    const reparsed = parseFile(b)
    expect(reparsed.rowStarts).toEqual([0, 30])
    expect(await decodeColumns(reparsed, 1, ['t', 'tag'])).toEqual([second.values[2], second.values[9]])
  })
  it('finds row group ranges when a dictionary column is not the first column', async () => {
    const groups = [group(0, 20), group(20, 20), group(40, 20)]
    const parsed = parseFile(
      buildFile(
        columns,
        groups.map((item) => item.encoded),
        kv,
        'test',
      ),
    )
    const file = buildFile(columns, [parsed.groups[0], parsed.groups[2]], kv, 'test')
    expect(await readAll(file)).toEqual([...rows(groups[0].values), ...rows(groups[2].values)])
  })
  it('decodes each row group of a file to exactly its own rows', async () => {
    const groups = [group(0, 25), group(25, 40), group(65, 1), group(66, 30)]
    const parsed = parseFile(
      buildFile(
        columns,
        groups.map((item) => item.encoded),
        kv,
        'test',
      ),
    )
    const names = columns.map((column) => column.name)
    for (const [index, item] of groups.entries()) expect(await decodeColumns(parsed, index, names)).toEqual(item.values)
    expect(await decodeColumns(parsed, 3, ['empty', 'n'])).toEqual([groups[3].values[8], groups[3].values[3]])
  })
  it('rejects damaged footers, wrong magic and files without the log format', () => {
    const file = buildFile(columns, [group(0, 10).encoded], kv, 'test')
    const damaged = file.slice()
    damaged.fill(0xff, damaged.length - 30, damaged.length - 8)
    expect(() => parseFile(damaged)).toThrow(ParquetFormatError)
    const magic = file.slice()
    magic[magic.length - 1] = 0
    expect(() => parseFile(magic)).toThrow(ParquetFormatError)
    expect(() => parseFile(buildFile(columns, [group(0, 10).encoded], {}, 'test'))).toThrow(ParquetFormatError)
    expect(() => parseFile(file, columns.slice(1))).toThrow(ParquetFormatError)
  })
  it('rejects unsafe integers', () => {
    const values: Cell[][] = columns.map(() => [null])
    values[1] = ['x']
    values[2] = [2 ** 60]
    expect(() => encodeRowGroup(columns, values)).toThrow()
  })
})
