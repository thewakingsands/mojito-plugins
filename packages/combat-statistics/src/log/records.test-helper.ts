import { readFile } from 'node:fs/promises'
import { decodeColumns, parseFile } from './parquet.js'
import { Assembler, COLUMN_NAMES, COLUMNS, type Row } from './schema.js'
import type { LogRecord } from './types.js'

/** Every record of a log file on disk, in order */
export async function records(path: string): Promise<LogRecord[]> {
  const parsed = parseFile(new Uint8Array(await readFile(path)), COLUMNS)
  const assembler = new Assembler()
  const result: LogRecord[] = []
  for (let group = 0; group < parsed.groups.length; group++) {
    const columns = await decodeColumns(parsed, group, COLUMN_NAMES)
    for (let index = 0; index < (columns[0]?.length ?? 0); index++) {
      const row: Row = {}
      COLUMN_NAMES.forEach((column, c) => {
        const cell = columns[c][index]
        if (cell !== null) row[column] = cell
      })
      result.push(...assembler.push(row))
    }
  }
  result.push(...assembler.flush())
  return result
}
