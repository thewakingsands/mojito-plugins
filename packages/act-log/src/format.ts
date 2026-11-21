import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

export type LogField = string | number
export interface LogRow {
  type: number
  timestamp: number
  fields: LogField[]
}

const encoder = new TextEncoder()
const pad = (n: number, width = 2) => n.toString().padStart(width, '0')
export const hex = (n: number, width = 0) => n.toString(16).toUpperCase().padStart(width, '0')

export function timestamp(ms: number) {
  const date = new Date(ms)
  if (!Number.isFinite(date.getTime())) throw new RangeError('Invalid source timestamp')
  const offset = -date.getTimezoneOffset()
  const day = [pad(date.getFullYear(), 4), pad(date.getMonth() + 1), pad(date.getDate())].join('-')
  const time = [date.getHours(), date.getMinutes(), date.getSeconds()].map((n) => pad(n)).join(':')
  return (
    day +
    'T' +
    time +
    '.' +
    pad(date.getMilliseconds(), 3) +
    '0000' +
    (offset < 0 ? '-' : '+') +
    pad(Math.floor(Math.abs(offset) / 60)) +
    ':' +
    pad(Math.abs(offset) % 60)
  )
}

export class LogFormat {
  private sequence = 0

  encode({ type, timestamp: ms, fields }: LogRow): Uint8Array {
    const columns = fields.map(String)
    if (columns.some((value) => /[|\r\n]/u.test(value))) throw new Error('Log field contains an unhandled separator')
    const content = [pad(type), timestamp(ms), ...columns].join('|')
    const sequence = type === 1 ? 1 : this.sequence + 1
    const hash = sha256(encoder.encode(`${content}|${sequence}`))
    this.sequence = sequence
    return encoder.encode(`${content}|${bytesToHex(hash.subarray(0, 8))}\r\n`)
  }
}
