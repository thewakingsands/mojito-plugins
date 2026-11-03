import { gunzipSync, gzipSync } from 'fflate'
import {
  type ColumnChunk,
  type ColumnData,
  type FileMetaData,
  parquetMetadata,
  parquetRead,
  type RowGroup,
  type SchemaElement,
} from 'hyparquet'
import { ByteWriter, ParquetWriter } from 'hyparquet-writer'

export type PhysicalType = 'BOOLEAN' | 'INT32' | 'INT64' | 'FLOAT' | 'DOUBLE' | 'BYTE_ARRAY'
export type Encoding = 'PLAIN' | 'RLE_DICTIONARY' | 'DELTA_BINARY_PACKED' | 'BYTE_STREAM_SPLIT'
export type Codec = 'UNCOMPRESSED' | 'GZIP'
export interface ColumnSpec {
  name: string
  type: PhysicalType
  /** BYTE_ARRAY columns carry the UTF8 annotation. */
  utf8: boolean
  required: boolean
  encoding: Encoding
  codec: Codec
}
export type Cell = boolean | number | string | null
/** Offsets in `meta` are relative to the start of `bytes`. */
export interface EncodedRowGroup {
  bytes: Uint8Array
  meta: RowGroup
}
export interface ParsedFile {
  groups: EncodedRowGroup[]
  kv: Record<string, string>
  /** First row number of each row group. */
  rowStarts: number[]
  metadata: FileMetaData
  buffer: ArrayBuffer
}
export class ParquetFormatError extends Error {}

export const FORMAT_KEY = 'mojito.format'
export const FORMAT = JSON.stringify({ format: 'mojito-combat-log', version: 1 })
const MAGIC = new Uint8Array([0x50, 0x41, 0x52, 0x31])

/**
 * ParquetWriter always opens with the 4-byte magic. Starting the offset 4 bytes early makes every offset it records
 * relative to the first byte after that magic, which is where the caller places the bytes.
 */
class PositionedWriter extends ByteWriter {
  constructor(position: number) {
    super()
    this.offset = position - 4
  }
}
function schema(columns: readonly ColumnSpec[]): SchemaElement[] {
  return [
    { name: 'root', num_children: columns.length },
    ...columns.map(
      (column): SchemaElement => ({
        name: column.name,
        type: column.type,
        repetition_type: column.required ? 'REQUIRED' : 'OPTIONAL',
        ...(column.utf8 ? { converted_type: 'UTF8' as const } : {}),
      }),
    ),
  ]
}
const compressors = { GZIP: (input: Uint8Array) => gzipSync(input, { level: 6 }) }
const decompressors = { GZIP: (input: Uint8Array) => gunzipSync(input) }
const tail = (writer: ByteWriter) => new Uint8Array(writer.getBuffer()).slice(4)

export function encodeRowGroup(columns: readonly ColumnSpec[], values: Cell[][]): EncodedRowGroup {
  const writer = new PositionedWriter(0)
  const parquet = new ParquetWriter({ writer, schema: schema(columns), statistics: false, compressors })
  const rows = values[0]?.length ?? 0
  void parquet.write({
    rowGroupSize: Number.POSITIVE_INFINITY,
    columnData: columns.map((column, index) => {
      const data = values[index]
      if (data.length !== rows) throw new Error(`列 ${column.name} 的行数不一致`)
      return {
        name: column.name,
        data: column.type === 'INT64' ? data.map((cell) => int64(column.name, cell)) : data,
        encoding: column.encoding,
        codec: column.codec,
        statistics: false,
        offsetIndex: false,
        columnIndex: false,
      }
    }),
  })
  return { bytes: tail(writer), meta: parquet.row_groups[0] }
}
function int64(name: string, cell: Cell) {
  if (cell === null) return null
  if (typeof cell !== 'number' || !Number.isSafeInteger(cell)) throw new Error(`列 ${name} 的值不是安全整数：${cell}`)
  return BigInt(cell)
}

function moved(group: RowGroup, delta: bigint): RowGroup {
  const columns = group.columns.map(
    (column): ColumnChunk => ({
      ...column,
      file_offset: column.file_offset + delta,
      ...(column.meta_data
        ? {
            meta_data: {
              ...column.meta_data,
              data_page_offset: column.meta_data.data_page_offset + delta,
              ...(column.meta_data.dictionary_page_offset !== undefined
                ? { dictionary_page_offset: column.meta_data.dictionary_page_offset + delta }
                : {}),
            },
          }
        : {}),
    }),
  )
  return { ...group, columns }
}

export function buildFile(
  columns: readonly ColumnSpec[],
  groups: EncodedRowGroup[],
  kv: Record<string, string>,
  createdBy: string,
): Uint8Array {
  let position = MAGIC.length
  const placed: RowGroup[] = []
  for (const group of groups) {
    placed.push(moved(group.meta, BigInt(position)))
    position += group.bytes.length
  }
  const writer = new PositionedWriter(position)
  const parquet = new ParquetWriter({
    writer,
    schema: schema(columns),
    statistics: false,
    compressors,
    kvMetadata: Object.entries(kv).map(([key, value]) => ({ key, value })),
    createdBy,
  })
  parquet.row_groups = placed
  parquet.num_rows = placed.reduce((sum, group) => sum + group.num_rows, 0n)
  void parquet.finish()
  const footer = tail(writer)
  const file = new Uint8Array(position + footer.length)
  file.set(MAGIC)
  let at = MAGIC.length
  for (const group of groups) {
    file.set(group.bytes, at)
    at += group.bytes.length
  }
  file.set(footer, at)
  return file
}

/** `expected` checks that the file was written with exactly these columns. */
export function parseFile(bytes: Uint8Array, expected?: readonly ColumnSpec[]): ParsedFile {
  const buffer = bytes.slice().buffer
  let metadata: FileMetaData
  try {
    metadata = parquetMetadata(buffer)
  } catch (error) {
    throw new ParquetFormatError(`文件尾无法解析：${String(error)}`)
  }
  const kv = Object.fromEntries((metadata.key_value_metadata ?? []).map(({ key, value }) => [key, value ?? '']))
  let format: { format?: unknown; version?: unknown } | null = null
  try {
    format = JSON.parse(kv[FORMAT_KEY] ?? 'null')
  } catch {
    /* Reported below as a missing format. */
  }
  if (format?.format !== 'mojito-combat-log') throw new ParquetFormatError('不是战斗日志文件')
  if (format.version !== 1) throw new ParquetFormatError(`不支持的日志版本：${String(format.version)}`)
  if (expected) {
    const actual = schema(expected).slice(1)
    const leaves = metadata.schema.slice(1)
    if (
      metadata.schema[0]?.num_children !== actual.length ||
      leaves.length !== actual.length ||
      actual.some(
        (column, index) =>
          leaves[index].name !== column.name ||
          leaves[index].type !== column.type ||
          leaves[index].repetition_type !== column.repetition_type,
      )
    )
      throw new ParquetFormatError('日志列与当前版本不一致')
  }
  const groups: EncodedRowGroup[] = []
  const rowStarts: number[] = []
  let rows = 0
  for (const group of metadata.row_groups) {
    let start: bigint | null = null
    for (const column of group.columns) {
      const meta = column.meta_data
      if (!meta) throw new ParquetFormatError('列块缺少元数据')
      const first = meta.dictionary_page_offset ?? meta.data_page_offset
      if (start === null || first < start) start = first
    }
    const length = group.total_compressed_size
    if (start === null || length === undefined || start < 4n || start + length > BigInt(bytes.length))
      throw new ParquetFormatError('行组范围无效')
    groups.push({
      bytes: bytes.slice(Number(start), Number(start + length)),
      meta: moved(group, -start),
    })
    rowStarts.push(rows)
    rows += Number(group.num_rows)
  }
  return { groups, kv, rowStarts, metadata, buffer }
}

export async function decodeColumns(file: ParsedFile, group: number, columns: string[]): Promise<Cell[][]> {
  const rowStart = file.rowStarts[group]
  const rowEnd = rowStart + Number(file.groups[group].meta.num_rows)
  const chunks = new Map<string, ColumnData[]>(columns.map((name) => [name, []]))
  try {
    await parquetRead({
      file: file.buffer,
      metadata: file.metadata,
      columns,
      rowStart,
      rowEnd,
      compressors: decompressors,
      // Errors thrown here would escape the read's promise, so values are only checked once it settles.
      onChunk: (chunk) => chunks.get(chunk.columnName)?.push(chunk),
    })
  } catch (error) {
    throw new ParquetFormatError(`行组解码失败：${String(error)}`)
  }
  return columns.map((name) => {
    // A column with no chunk for some rows reads as null there, so every column keeps the group's row count.
    const cells: Cell[] = new Array(rowEnd - rowStart).fill(null)
    for (const chunk of chunks.get(name)!) {
      // A chunk may cover rows outside the group.
      const from = Math.max(chunk.rowStart, rowStart),
        to = Math.min(chunk.rowEnd, rowEnd)
      for (let row = from; row < to; row++) cells[row - rowStart] = cell(name, chunk.columnData[row - chunk.rowStart])
    }
    return cells
  })
}
function cell(name: string, value: unknown): Cell {
  if (value === undefined || value === null) return null
  if (typeof value === 'bigint') {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER))
      throw new ParquetFormatError(`列 ${name} 的值超出安全整数范围`)
    return Number(value)
  }
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return value
  throw new ParquetFormatError(`列 ${name} 的值类型无法识别`)
}
