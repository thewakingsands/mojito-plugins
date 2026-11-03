import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { canonical, type FightEndNote, parseNote, type Row } from './schema.js'
import { LogIntegrityError } from './types.js'

const encoder = new TextEncoder()
/** Rows reach SHA-256 in batches of about this many characters, which is much faster than one update per row. */
const BATCH = 64 * 1024
/** One SHA-256 per fight, fed row by row from fightStart up to and including the fightEnd note without its hash. */
export class FightHash {
  private hash = sha256.create()
  private pending = ''
  update(row: Row) {
    this.pending += `${canonical(row)}\n`
    if (this.pending.length >= BATCH) this.drain()
  }
  finish(endRow: Row, endNote: FightEndNote): string {
    const { hash: _, ...note } = endNote
    this.update({ ...endRow, note: JSON.stringify(note) })
    this.drain()
    return `sha256:${bytesToHex(this.hash.digest())}`
  }
  private drain() {
    this.hash.update(encoder.encode(this.pending))
    this.pending = ''
  }
}

/** Recomputes each fight's hash while rows are read in file order. */
export class HashCheck {
  private current: FightHash | null = null
  push(row: Row) {
    if (row.kind === 'fightStart') this.current = new FightHash()
    const current = this.current
    if (!current) {
      if (row.kind === 'fightEnd') throw new LogIntegrityError('日志校验失败')
      return
    }
    if (row.kind !== 'fightEnd') {
      current.update(row)
      return
    }
    this.current = null
    const note = parseNote('fightEnd', row.note ?? null) as FightEndNote
    // A truncated fight has no hash by design; any other fight must carry a matching one.
    if (note.truncated && note.hash === null) return
    if (typeof note.hash !== 'string' || current.finish(row, note) !== note.hash)
      throw new LogIntegrityError('日志校验失败')
  }
}
