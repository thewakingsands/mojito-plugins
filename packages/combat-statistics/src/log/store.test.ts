import type { Field, Limits, SessionSnapshot } from '@ffcafe/mojito-plugin-sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { effect, actors as fixtureActors, meta, unobserved } from '../fixtures.js'
import type { Summary } from '../model.js'
import { Recorder } from './recorder.js'
import { fileRows, memoryStorage } from './storage.test-helper.js'
import { LogStore, SPACE_FULL } from './store.js'
import type { Carry, LogEvent, LogRecord } from './types.js'

const KiB = 1024,
  MiB = 1024 * KiB
const field = <T>(value: T): Field<T> => ({
  state: 'ok',
  value,
  observedAt: 0,
  from: 'packet',
  timeBase: 'packet-unix',
})
const carry: Carry = {
  encounters: { localActorId: 1, inCombat: null, combatValue: null, packetSeq: null, combatSeq: null, combatAt: null },
  generations: [],
}
const summary = { durationMs: 1, rows: [] } as unknown as Summary
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime()

function setup(
  fileBytes = 3 * MiB,
  pluginBytes = 32 * MiB,
  memory = memoryStorage(),
  reservedBytes = 0,
  listItems = 1000,
) {
  const limits = {
    values: { 'storage.fileBytes': fileBytes, 'storage.pluginBytes': pluginBytes, 'storage.listItems': listItems },
  } as unknown as Limits
  const store = new LogStore(memory.storage, limits, 'test', undefined, reservedBytes)
  const recorder = new Recorder({
    sink: store,
    actors: fixtureActors,
    names: { zone: () => '区域', job: () => null },
    brief: () => ({ result: null, mainEnemy: null }),
    positions: () => {},
  })
  recorder.source({
    state: 'replay',
    sessionId: 's',
    characterGeneration: 1,
    clock: { generation: 1 },
    character: { actorId: 1 },
    dataLanguage: 'chs',
  } as unknown as SessionSnapshot)
  let seed = 1
  const random = () => {
    seed = (seed * 48271) % 2147483647
    return seed
  }
  // Random effect amounts barely compress, and events are not repeated in the next visit's snapshot.
  const noise = (bytes: number): LogEvent => {
    const value = effect(random())
    value.data.targets = Array.from({ length: Math.ceil(bytes / 9) }, () => ({
      targetPosition: unobserved,
      rawEntries: [],
      targetId: 9,
      effects: [{ ...value.data.targets[0].effects[0], rawValue: random() / 7 }],
    }))
    return value
  }
  return {
    ...memory,
    store,
    recorder,
    enter(t: number, territoryType = 1263) {
      recorder.zone({ territoryType: field(territoryType), mapId: field(1) }, t, carry)
      recorder.identities('entities', [], [], new Set([1, 2]), 'party', t)
    },
    /** Writes an event of roughly `bytes` compressed bytes. */
    noise: (t: number, bytes = 4 * KiB) => recorder.event({ meta: meta(t), value: noise(bytes) }),
    names: () => [...memory.files.keys()].filter((name) => name.startsWith('log/')).sort(),
  }
}
async function records(store: LogStore, visit: string, current = false) {
  const out: LogRecord[] = []
  for await (const record of store.read(visit, current, !current)) out.push(record)
  return out
}

describe('log store', () => {
  it('writes one file per local day and keeps a visit that crosses midnight in its first day', async () => {
    const h = setup()
    await h.store.open()
    h.enter(at(26, 23, 50))
    h.noise(at(26, 23, 55))
    await h.store.flush()
    h.noise(at(27, 0, 5))
    h.enter(at(27, 0, 10), 339)
    await h.store.flush()
    expect(h.names()).toEqual(['log/2026-10-26.parquet', 'log/2026-10-27.parquet'])
    const first = await fileRows(h.files.get('log/2026-10-26.parquet')!)
    expect(new Set(first.map((row) => row.visit))).toEqual(new Set(['20261026-235000-1263']))
    expect(first.map((row) => row.kind)).toContain('visitEnd')
    const second = await fileRows(h.files.get('log/2026-10-27.parquet')!)
    expect(new Set(second.map((row) => row.visit))).toEqual(new Set(['20261027-001000-339']))
  })
  it('continues the last file of the day after a restart', async () => {
    const memory = memoryStorage()
    const first = setup(undefined, undefined, memory)
    await first.store.open()
    first.enter(at(26, 10))
    first.recorder.stop(at(26, 10, 5))
    await first.store.flush()
    const second = setup(undefined, undefined, memory)
    await second.store.open()
    second.enter(at(26, 11))
    second.recorder.stop(at(26, 11, 5))
    await second.store.flush()
    expect(second.names()).toEqual(['log/2026-10-26.parquet'])
    const visits = (await fileRows(memory.files.get('log/2026-10-26.parquet')!)).map((row) => row.visit)
    expect(new Set(visits)).toEqual(new Set(['20261026-100000-1263', '20261026-110000-1263']))
  })
  it('reads the recorded self of a visit, and null from a visitStart written before it was recorded', async () => {
    const memory = memoryStorage()
    const first = setup(undefined, undefined, memory)
    await first.store.open()
    first.enter(at(26, 10))
    first.recorder.stop(at(26, 10, 5))
    const append = first.store.append.bind(first.store)
    first.store.append = (row) => {
      if (row.kind !== 'visitStart') return append(row)
      const { self: _, ...old } = JSON.parse(String(row.note))
      append({ ...row, note: JSON.stringify(old) })
    }
    first.enter(at(26, 11), 339)
    first.recorder.stop(at(26, 11, 5))
    await first.store.flush()
    const second = setup(undefined, undefined, memory)
    await second.store.open()
    const entries = second.store.index.entries
    expect(entries.get('20261026-100000-1263')!.self).toBe(1)
    expect(entries.get('20261026-110000-339')).toMatchObject({ self: null, endReason: 'stopped' })
  })
  it('moves to the next part of the day near the file limit and keeps a fight in one file', async () => {
    const h = setup(64 * KiB + 24 * KiB)
    await h.store.open()
    h.enter(at(26, 10))
    let t = at(26, 10)
    const step = () => {
      t += 1000
      return t
    }
    for (let i = 0; i < 3; i++) {
      h.noise(step())
      await h.store.flush()
    }
    expect(h.names()).toEqual(['log/2026-10-26.parquet'])
    h.recorder.fightStarted({ id: 'enc-1', at: step() })
    for (let i = 0; i < 4; i++) {
      h.noise(step())
      await h.store.flush()
    }
    h.recorder.fightEnded({ id: 'enc-1', reason: 'manual', at: step(), summary })
    h.recorder.flushBoundaries()
    await h.store.flush()
    expect(h.names()).toEqual(['log/2026-10-26-2.parquet', 'log/2026-10-26.parquet'])
    for (const name of h.names()) expect(h.files.get(name)!.length).toBeLessThanOrEqual(24 * KiB)
    const first = await fileRows(h.files.get('log/2026-10-26.parquet')!)
    const second = await fileRows(h.files.get('log/2026-10-26-2.parquet')!)
    expect(first.some((row) => row.fight !== null && row.fight !== undefined)).toBe(false)
    const fight = second.filter((row) => row.fight === 1).map((row) => row.kind)
    expect([fight[0], fight.at(-1), fight.filter((kind) => kind === 'action').length]).toEqual([
      'fightStart',
      'fightEnd',
      4,
    ])
    expect(JSON.parse(second.find((row) => row.kind === 'fightEnd')!.note).truncated).toBe(false)
    const read = await records(h.store, '20261026-100000-1263')
    expect(read.filter((record) => record.kind === 'event')).toHaveLength(7)
    expect(h.store.index.entries.get('20261026-100000-1263')?.fights[0]).toMatchObject({ hashed: true })
  })
  it('truncates a fight that alone exceeds the file limit', async () => {
    const h = setup(64 * KiB + 16 * KiB)
    await h.store.open()
    h.enter(at(26, 10))
    let t = at(26, 10)
    const step = () => {
      t += 1000
      return t
    }
    h.recorder.fightStarted({ id: 'enc-1', at: step() })
    for (let i = 0; i < 8; i++) {
      h.noise(step())
      await h.store.flush()
    }
    h.recorder.fightEnded({ id: 'enc-1', reason: 'manual', at: step(), summary })
    h.recorder.flushBoundaries()
    await h.store.flush()
    for (const name of h.names()) expect(h.files.get(name)!.length).toBeLessThanOrEqual(16 * KiB)
    const rows = (await Promise.all(h.names().map((name) => fileRows(h.files.get(name)!)))).flat()
    const end = rows.find((row) => row.kind === 'fightEnd')!
    expect(JSON.parse(end.note)).toMatchObject({ truncated: true, hash: null })
    expect(rows.filter((row) => row.kind === 'action').length).toBeLessThan(8)
    expect(await records(h.store, '20261026-100000-1263')).toContainEqual(
      expect.objectContaining({ kind: 'fightEnd', reason: 'manual' }),
    )
  })
  it('deletes the oldest files to stay within the budget, never the current visit', async () => {
    const h = setup(3 * MiB, MiB + 40 * KiB)
    await h.store.open()
    for (const day of [20, 21, 22]) {
      h.enter(at(day, 10), day)
      h.noise(at(day, 10, 1), 15 * KiB)
      h.recorder.stop(at(day, 10, 2))
      await h.store.flush()
    }
    expect(h.names()).toEqual(['log/2026-10-21.parquet', 'log/2026-10-22.parquet'])
    expect([...h.store.index.entries.keys()]).toEqual(['20261021-100000-21', '20261022-100000-22'])
    h.enter(at(23, 10), 23)
    for (let i = 0; i < 3; i++) {
      h.noise(at(23, 10, i + 1), 15 * KiB)
      await h.store.flush()
    }
    expect(h.names()).toEqual(['log/2026-10-23.parquet'])
    expect(h.store.error).toBe(SPACE_FULL)
    const kept = h.files.get('log/2026-10-23.parquet')!
    h.noise(at(23, 11), 1 * KiB)
    await h.store.flush()
    expect(h.files.get('log/2026-10-23.parquet')).toBe(kept)
    h.recorder.stop(at(23, 12))
    h.enter(at(24, 10), 24)
    h.noise(at(24, 10, 1), 1 * KiB)
    await h.store.flush()
    expect(h.store.error).toBeNull()
    expect(h.names()).toContain('log/2026-10-24.parquet')
  })
  it('leaves the storage reserved for other files out of the budget', async () => {
    const days = async (reserved: number) => {
      const h = setup(3 * MiB, MiB + 60 * KiB, memoryStorage(), reserved)
      await h.store.open()
      for (const day of [20, 21, 22]) {
        h.enter(at(day, 10), day)
        h.noise(at(day, 10, 1), 15 * KiB)
        h.recorder.stop(at(day, 10, 2))
        await h.store.flush()
      }
      return h.names()
    }
    expect(await days(0)).toHaveLength(3)
    expect(await days(20 * KiB)).toEqual(['log/2026-10-21.parquet', 'log/2026-10-22.parquet'])
  })
  it('deletes the oldest file and retries when storage reports quota_exceeded', async () => {
    const h = setup()
    await h.store.open()
    h.enter(at(20, 10), 20)
    h.recorder.stop(at(20, 11))
    await h.store.flush()
    h.enter(at(21, 10), 21)
    h.failures.push(() => ({ code: 'quota_exceeded', message: 'full' }))
    await h.store.flush()
    expect(h.store.error).toBeNull()
    expect(h.names()).toEqual(['log/2026-10-21.parquet'])
  })
  it('keeps rows after a failed write and clears the error once a write succeeds', async () => {
    const h = setup()
    await h.store.open()
    h.enter(at(26, 10))
    h.noise(at(26, 10, 1), 100)
    h.failures.push(() => new Error('disk'))
    await h.store.flush()
    expect(h.store.error).toBe('日志写入失败：disk')
    expect(h.names()).toEqual([])
    h.noise(at(26, 10, 2), 100)
    await h.store.flush()
    expect(h.store.error).toBeNull()
    const rows = await fileRows(h.files.get('log/2026-10-26.parquet')!)
    expect(rows.filter((row) => row.kind === 'action')).toHaveLength(2)
  })
  it('clears every visit except the current one', async () => {
    const h = setup()
    await h.store.open()
    h.enter(at(25, 10), 1)
    h.recorder.stop(at(25, 11))
    h.enter(at(26, 10), 2)
    h.recorder.stop(at(26, 11))
    h.enter(at(26, 12), 3)
    await h.store.flush()
    await h.store.clear('20261026-120000-3')
    expect(h.names()).toEqual(['log/2026-10-26.parquet'])
    const rows = await fileRows(h.files.get('log/2026-10-26.parquet')!)
    expect(new Set(rows.map((row) => row.visit))).toEqual(new Set(['20261026-120000-3']))
    expect([...h.store.index.entries.keys()]).toEqual(['20261026-120000-3'])
  })
  it('skips an unrecognized file without overwriting it', async () => {
    const memory = memoryStorage()
    const junk = new TextEncoder().encode('not parquet')
    memory.files.set('log/2026-10-26.parquet', junk)
    const h = setup(undefined, undefined, memory)
    await h.store.open()
    h.enter(at(26, 10))
    await h.store.flush()
    expect(h.files.get('log/2026-10-26.parquet')).toBe(junk)
    expect(h.names()).toEqual(['log/2026-10-26-2.parquet', 'log/2026-10-26.parquet'])
    expect(h.store.index.entries.size).toBe(1)
  })
  it('keeps a single fight above the old 3 MiB limit in one file with a 16 MiB limit', async () => {
    const h = setup(16 * MiB, 2048 * MiB)
    await h.store.open()
    h.enter(at(26, 10))
    h.recorder.fightStarted({ id: 'enc-1', at: at(26, 10) })
    h.noise(at(26, 10, 1), 3600 * KiB)
    await h.store.flush()
    expect(h.store.fightTruncated()).toBe(false)
    h.recorder.fightEnded({ id: 'enc-1', reason: 'manual', at: at(26, 11), summary })
    h.recorder.stop(at(26, 11))
    await h.store.flush()
    expect(h.names()).toEqual(['log/2026-10-26.parquet'])
    expect(h.files.get('log/2026-10-26.parquet')!.length).toBeGreaterThan(3 * MiB)
    expect(h.store.error).toBeNull()
  }, 60_000)
})

describe('log store opening a long log', () => {
  afterEach(() => {
    vi.useRealTimers()
  })
  /** One visit with a fight on each given day of October 2026; the clock ends on the day after the last. */
  async function history(days: number[]) {
    vi.useFakeTimers({ toFake: ['Date'] })
    const memory = memoryStorage()
    const h = setup(undefined, undefined, memory)
    await h.store.open()
    for (const day of days) {
      vi.setSystemTime(at(day, 10))
      h.enter(at(day, 10), day)
      h.recorder.fightStarted({ id: `enc-${day}`, at: at(day, 10) })
      h.noise(at(day, 10, 1))
      h.recorder.fightEnded({ id: `enc-${day}`, reason: 'manual', at: at(day, 11), summary })
      h.recorder.stop(at(day, 12))
      await h.store.flush()
    }
    vi.setSystemTime(at(days.at(-1)! + 1, 9))
    return memory
  }
  /** A new store over `memory` that records which files it reads. */
  function reopen(memory: ReturnType<typeof memoryStorage>, listItems?: number) {
    const reads: string[] = []
    const counted = {
      ...memory,
      storage: {
        ...memory.storage,
        read: (path: string) => {
          reads.push(path)
          return memory.storage.read(path)
        },
      },
    }
    return { ...setup(undefined, undefined, counted, 0, listItems), reads }
  }
  const visitDays = (h: ReturnType<typeof setup>) =>
    [...h.store.index.entries.values()].map((entry) => entry.territoryType).sort((a, b) => a - b)

  it('reads from the newest file and stops once enough visits are found', async () => {
    const memory = await history([20, 21, 22, 23])
    const h = reopen(memory)
    await h.store.open(2)
    expect(h.reads).toEqual(['log/2026-10-23.parquet', 'log/2026-10-22.parquet'])
    expect(visitDays(h)).toEqual([22, 23])
  })
  it('reads every file of a long log when it holds fewer visits than it looks for', async () => {
    const memory = await history([20, 21, 22])
    const h = reopen(memory)
    await h.store.open()
    expect(visitDays(h)).toEqual([20, 21, 22])
  })
  it('does not count a visit without a fight towards the visits it looks for', async () => {
    const memory = await history([20, 21])
    const quiet = setup(undefined, undefined, memory)
    await quiet.store.open()
    vi.setSystemTime(at(22, 10))
    quiet.enter(at(22, 10), 22)
    quiet.recorder.stop(at(22, 11))
    await quiet.store.flush()
    const h = reopen(memory)
    await h.store.open(1)
    expect(h.reads).toEqual(['log/2026-10-22.parquet', 'log/2026-10-21.parquet'])
    expect(visitDays(h)).toEqual([21, 22])
  })
  it('keeps reading until it has the start of a visit that spans files', async () => {
    const memory = await history([20])
    const writer = setup(88 * KiB, undefined, memory)
    await writer.store.open()
    vi.setSystemTime(at(21, 10))
    writer.enter(at(21, 10), 21)
    let t = at(21, 10)
    const step = () => {
      t += 1000
      return t
    }
    for (let i = 0; i < 3; i++) {
      writer.noise(step())
      await writer.store.flush()
    }
    writer.recorder.fightStarted({ id: 'enc-21', at: step() })
    for (let i = 0; i < 4; i++) {
      writer.noise(step())
      await writer.store.flush()
    }
    writer.recorder.fightEnded({ id: 'enc-21', reason: 'manual', at: step(), summary })
    writer.recorder.stop(step())
    await writer.store.flush()
    vi.setSystemTime(at(22, 9))
    const h = reopen(memory)
    await h.store.open(1)
    expect(h.reads).toEqual(['log/2026-10-21-2.parquet', 'log/2026-10-21.parquet'])
    expect(visitDays(h)).toEqual([21])
    expect([...h.store.index.entries.values()][0].fights).toHaveLength(1)
  })
  it('reads the files open left unread one at a time, newest first', async () => {
    const memory = await history([20, 21, 22, 23])
    const h = reopen(memory)
    await h.store.open(1)
    expect(h.reads).toEqual(['log/2026-10-23.parquet'])
    expect(await h.store.readOlder()).toBe(true)
    expect(await h.store.readOlder()).toBe(true)
    expect(await h.store.readOlder()).toBe(false)
    expect(await h.store.readOlder()).toBe(false)
    expect(h.reads).toEqual([
      'log/2026-10-23.parquet',
      'log/2026-10-22.parquet',
      'log/2026-10-21.parquet',
      'log/2026-10-20.parquet',
    ])
    expect(visitDays(h)).toEqual([20, 21, 22, 23])
  })
  it('reads only the unread files within a date range, a day wider at each end', async () => {
    const memory = await history([17, 18, 19, 20, 21, 22, 23])
    const h = reopen(memory)
    await h.store.open(1)
    const range = { from: '2026-10-19', to: '2026-10-20' }
    expect(await h.store.readOlder(range)).toBe(true)
    expect(await h.store.readOlder(range)).toBe(true)
    expect(await h.store.readOlder(range)).toBe(true)
    expect(await h.store.readOlder(range)).toBe(false)
    expect(await h.store.readOlder(range)).toBe(false)
    expect(h.reads).toEqual([
      'log/2026-10-23.parquet',
      'log/2026-10-21.parquet',
      'log/2026-10-20.parquet',
      'log/2026-10-19.parquet',
      'log/2026-10-18.parquet',
    ])
  })
  it('reads from the newest file a day past an end date', async () => {
    const h = reopen(await history([17, 18, 19, 20, 21, 22, 23]))
    await h.store.open(1)
    expect(await h.store.readOlder({ from: null, to: '2026-10-18' })).toBe(true)
    expect(h.reads.at(-1)).toBe('log/2026-10-19.parquet')
  })
  it('stops a day before a start date', async () => {
    const h = reopen(await history([17, 18, 19, 20, 21, 22, 23]))
    await h.store.open(1)
    expect(await h.store.readOlder({ from: '2026-10-22', to: null })).toBe(true)
    expect(await h.store.readOlder({ from: '2026-10-22', to: null })).toBe(false)
    expect(h.reads).toEqual(['log/2026-10-23.parquet', 'log/2026-10-22.parquet', 'log/2026-10-21.parquet'])
  })
  it('leaves the files outside a range for a later read without one', async () => {
    const h = reopen(await history([17, 18, 19, 20, 21, 22, 23]))
    await h.store.open(1)
    const range = { from: '2026-10-19', to: '2026-10-20' }
    while (await h.store.readOlder(range));
    while (await h.store.readOlder());
    expect(h.reads.slice(-2)).toEqual(['log/2026-10-22.parquet', 'log/2026-10-17.parquet'])
    expect(visitDays(h)).toEqual([17, 18, 19, 20, 21, 22, 23])
  })
  it('lists a visit that spans files once the older file with its start is read', async () => {
    const memory = await history([20])
    const writer = setup(88 * KiB, undefined, memory)
    await writer.store.open()
    vi.setSystemTime(at(21, 10))
    writer.enter(at(21, 10), 21)
    let t = at(21, 10)
    const step = () => {
      t += 1000
      return t
    }
    for (let i = 0; i < 3; i++) {
      writer.noise(step())
      await writer.store.flush()
    }
    writer.recorder.fightStarted({ id: 'enc-21', at: step() })
    for (let i = 0; i < 4; i++) {
      writer.noise(step())
      await writer.store.flush()
    }
    writer.recorder.fightEnded({ id: 'enc-21', reason: 'manual', at: step(), summary })
    writer.recorder.stop(step())
    await writer.store.flush()
    vi.setSystemTime(at(22, 9))
    const h = reopen(memory)
    await h.store.open(0, 0)
    expect(h.reads).toEqual(['log/2026-10-21-2.parquet'])
    expect(visitDays(h)).toEqual([])
    expect(await h.store.readOlder()).toBe(true)
    expect(visitDays(h)).toEqual([21])
    const fights = [...h.store.index.entries.values()][0].fights
    expect(fights).toHaveLength(1)
    expect(fights[0].endAt).not.toBeNull()
  })
  it('reads the records of a file read later, and evicts it oldest first', async () => {
    const memory = await history([20, 21, 22, 23])
    const h = reopen(memory)
    await h.store.open(0, 0)
    while (await h.store.readOlder());
    const kinds: string[] = []
    for await (const record of h.store.read('20261020-100000-20', false, true)) kinds.push(record.kind)
    expect(kinds[0]).toBe('visitStart')
    expect(kinds).toContain('fightEnd')
    memory.failures.push(
      () => ({ code: 'quota_exceeded' }),
      () => ({ code: 'quota_exceeded' }),
    )
    h.enter(at(24, 10), 24)
    await h.store.flush()
    expect(h.names()).toEqual(['log/2026-10-22.parquet', 'log/2026-10-23.parquet', 'log/2026-10-24.parquet'])
    expect(visitDays(h)).toEqual([22, 23, 24])
  })
  it('drops a file that a clear removed while it was read', async () => {
    const memory = await history([20, 21])
    const h = reopen(memory)
    await h.store.open(0, 0)
    let release = () => {}
    const read = memory.storage.read
    // The bytes are read at once, so only the end of the read waits.
    memory.storage.read = (path) => {
      const bytes = read(path)
      return new Promise((resolve) => {
        release = () => resolve(bytes)
      })
    }
    const reading = h.store.readOlder()
    await h.store.clear(null)
    release()
    expect(await reading).toBe(false)
    expect(h.store.index.entries.size).toBe(0)
    expect(h.names()).toEqual([])
    // The file is not known either: its name is free again.
    h.enter(at(20, 14), 120)
    h.recorder.stop(at(20, 15))
    await h.store.flush()
    expect(h.names()).toEqual(['log/2026-10-20.parquet'])
  })
  it('skips an unrecognized file it reads later without overwriting it', async () => {
    const memory = await history([21, 22])
    const junk = new TextEncoder().encode('not parquet')
    memory.files.set('log/2026-10-20.parquet', junk)
    const h = reopen(memory)
    await h.store.open(0, 0)
    expect(await h.store.readOlder()).toBe(true)
    expect(await h.store.readOlder()).toBe(false)
    expect(visitDays(h)).toEqual([21, 22])
    h.enter(at(20, 14), 120)
    h.recorder.stop(at(20, 15))
    await h.store.flush()
    expect(h.files.get('log/2026-10-20.parquet')).toBe(junk)
    expect(h.names()).toContain('log/2026-10-20-2.parquet')
  })
  it('stops at the time budget, but still reads today and the last file', async () => {
    const memory = await history([20, 21, 22, 23])
    vi.setSystemTime(at(22, 9))
    const h = reopen(memory)
    await h.store.open(100, 0)
    expect(h.reads).toEqual(['log/2026-10-23.parquet', 'log/2026-10-22.parquet'])
    expect(visitDays(h)).toEqual([22, 23])
  })
  it('continues today after an open that stopped early', async () => {
    const memory = await history([20, 21])
    vi.setSystemTime(at(21, 13))
    const h = reopen(memory)
    await h.store.open(0, 0)
    h.enter(at(21, 14), 121)
    h.recorder.stop(at(21, 15))
    await h.store.flush()
    expect(h.names()).toEqual(['log/2026-10-20.parquet', 'log/2026-10-21.parquet'])
    const again = reopen(memory)
    await again.store.open()
    expect(visitDays(again)).toEqual([20, 21, 121])
  })
  it('does not reuse the name of an unread file and deletes it on clear', async () => {
    const memory = await history([20, 21])
    const h = reopen(memory)
    await h.store.open(0, 0)
    expect(h.reads).toEqual(['log/2026-10-21.parquet'])
    h.enter(at(20, 14), 120)
    await h.store.flush()
    expect(h.names()).toContain('log/2026-10-20-2.parquet')
    h.recorder.stop(at(20, 15))
    await h.store.flush()
    await h.store.clear(null)
    expect(h.names()).toEqual([])
  })
  it('deletes unread files first when storage reports quota_exceeded, as many as the write needs', async () => {
    const memory = await history([20, 21, 22, 23])
    const h = reopen(memory)
    await h.store.open(0, 0)
    memory.failures.push(
      () => ({ code: 'quota_exceeded' }),
      () => ({ code: 'quota_exceeded' }),
    )
    h.enter(at(24, 10), 24)
    await h.store.flush()
    expect(h.store.error).toBeNull()
    expect(h.names()).toEqual(['log/2026-10-22.parquet', 'log/2026-10-23.parquet', 'log/2026-10-24.parquet'])
  })
  it('keeps the log when a single file is too large for the host', async () => {
    const memory = await history([20, 21])
    const h = setup(100 * KiB, undefined, memory)
    await h.store.open()
    memory.failures.push(() => ({ code: 'quota_exceeded', message: 'too large' }))
    h.enter(at(22, 10), 22)
    h.noise(at(22, 10, 1), 200 * KiB)
    await h.store.flush()
    expect(h.names()).toEqual(['log/2026-10-20.parquet', 'log/2026-10-21.parquet'])
    expect(h.store.error).toContain('too large')
  })
  it('keeps the number of files below the limit of a listing, deleting the oldest', async () => {
    const memory = await history([20, 21, 22])
    const h = reopen(memory, 19)
    await h.store.open(0, 0)
    for (const day of [23, 24, 25]) {
      vi.setSystemTime(at(day, 10))
      h.enter(at(day, 10), day)
      h.recorder.stop(at(day, 11))
      await h.store.flush()
    }
    expect(h.names()).toEqual(['log/2026-10-23.parquet', 'log/2026-10-24.parquet', 'log/2026-10-25.parquet'])
  })
})
