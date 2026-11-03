import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { FightHash, HashCheck } from './hash.js'
import { canonical, type FightEndNote, fightEndNote, fightStartNote, noteRow, type Row } from './schema.js'
import { LogIntegrityError } from './types.js'

const end = (patch: Partial<FightEndNote> = {}) => ({
  ...fightEndNote({
    visit: 'v',
    fight: 1,
    endAt: 0,
    durationMs: 1000,
    reason: 'quiet',
    result: 'wipe',
    mainEnemy: { name: '暗黑领主', hpCur: 5, hpMax: 10, hpPercent: 50 },
    deaths: 2,
    truncated: false,
  }),
  endAt: '2026-10-26 20:00:00.000 +08:00',
  ...patch,
})
function fight(): Row[] {
  const start: Row = {
    ...noteRow({
      ...fightStartNote({ visit: 'v', fight: 1, id: 'enc-1', zone: '区域', enteredAt: 0, startAt: 0, scope: 'party' }),
      enteredAt: '2026-10-26 20:00:00.000 +08:00',
      startAt: '2026-10-26 20:00:00.000 +08:00',
    }),
    visit: 'v',
    t: 100,
    fight: 1,
  }
  const rows: Row[] = [
    { kind: 'party', visit: 'v', t: 50, data: '{}' },
    start,
    { kind: 'action', visit: 'v', t: 110, fight: 1, actor: 1, action: 7, seq: 1, aoe: false },
    { kind: 'effect', visit: 'v', t: 110, fight: 1, actor: 1, amount: 100.5 },
    { kind: 'pos', visit: 'v', t: 120, fight: 1, actor: 1, x: 0.1, z: 0.2, rotation: 3 },
  ]
  const hash = new FightHash()
  for (const row of rows.slice(1)) hash.update(row)
  const endRow: Row = { kind: 'fightEnd', visit: 'v', t: 200, fight: 1 }
  const note = end()
  rows.push({ ...noteRow({ ...note, hash: hash.finish(endRow, note) }), visit: 'v', t: 200, fight: 1 })
  rows.push({ kind: 'party', visit: 'v', t: 250, data: '{}' })
  return rows
}
const check = (rows: Row[]) => {
  const checker = new HashCheck()
  for (const row of rows) checker.push(row)
}
const endIndex = 5

describe('fight hash', () => {
  it('gives a fixed value for fixed rows', () => {
    const rows = fight()
    expect(JSON.parse(String(rows[endIndex].note)).hash).toBe(
      'sha256:2120e993c8b2fade0b0676edd5a2ad74b2b51779a4c252c5bc35d16e85eaad98',
    )
    const { hash: _, ...note } = JSON.parse(String(rows[endIndex].note))
    const lines = [...rows.slice(1, endIndex), { ...rows[endIndex], note: JSON.stringify(note) }]
    const expected = createHash('sha256')
      .update(lines.map((row) => `${canonical(row)}\n`).join(''))
      .digest('hex')
    expect(JSON.parse(String(rows[endIndex].note)).hash).toBe(`sha256:${expected}`)
    expect(() => check(rows)).not.toThrow()
  })
  it('detects changed, removed and swapped rows and a changed result', () => {
    const changed = fight()
    changed[3] = { ...changed[3], amount: 100.25 }
    expect(() => check(changed)).toThrow(LogIntegrityError)
    const removed = fight()
    removed.splice(3, 1)
    expect(() => check(removed)).toThrow(LogIntegrityError)
    const swapped = fight()
    ;[swapped[2], swapped[3]] = [swapped[3], swapped[2]]
    expect(() => check(swapped)).toThrow(LogIntegrityError)
    const result = fight()
    const note = JSON.parse(String(result[endIndex].note))
    result[endIndex] = { ...result[endIndex], note: JSON.stringify({ ...note, result: 'kill', cleared: true }) }
    expect(() => check(result)).toThrow(LogIntegrityError)
    const dropped = fight()
    dropped[endIndex] = { ...dropped[endIndex], note: JSON.stringify({ ...note, hash: null }) }
    expect(() => check(dropped)).toThrow(LogIntegrityError)
  })
  it('ignores rows outside fights', () => {
    const rows = fight()
    rows[0] = { ...rows[0], data: '{"changed":true}' }
    rows[rows.length - 1] = { ...rows[rows.length - 1], data: '{"changed":true}' }
    expect(() => check(rows)).not.toThrow()
  })
  it('accepts a truncated fight without a hash', () => {
    const rows = fight()
    const note = JSON.parse(String(rows[endIndex].note))
    rows[endIndex] = { ...rows[endIndex], note: JSON.stringify({ ...note, truncated: true, hash: null }) }
    expect(() => check(rows)).not.toThrow()
  })
})
