import type { Field, Limits, SessionSnapshot } from '@ffcafe/mojito-plugin-sdk'
import { describe, expect, it } from 'vitest'
import { castSpace, effect, actors as fixtureActors, meta, tick } from '../fixtures.js'
import type { Summary } from '../model.js'
import { CombatLog } from './index.js'
import { buildFile, type Cell, decodeColumns, encodeRowGroup, parseFile } from './parquet.js'
import { COLUMN_NAMES, COLUMNS } from './schema.js'
import { memoryStorage } from './storage.test-helper.js'
import { type Carry, LogIntegrityError, type LogRecord } from './types.js'

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
const summary = { durationMs: 4000, rows: [{ totals: { deaths: 1 } }] } as unknown as Summary
const T = new Date(2026, 9, 26, 20, 0).getTime()
const limits = { values: {} } as unknown as Limits
const mainEnemy = { name: '暗黑领主', hpCur: 2340000, hpMax: 10000000, hpPercent: 23.4 }

function open(memory = memoryStorage()) {
  const log = new CombatLog(memory.storage, limits, {
    createdBy: 'test',
    actors: fixtureActors,
    names: { zone: (id) => `区域${id}`, job: (id) => (id === 19 ? '骑士' : null) },
    brief: () => ({ result: 'wipe', mainEnemy }),
    positions: () => {},
  })
  const r = log.recorder
  return {
    log,
    memory,
    source: () =>
      r.source({
        state: 'replay',
        sessionId: 'source',
        characterGeneration: 1,
        clock: { generation: 1 },
        character: { actorId: 1 },
        dataLanguage: 'chs',
      } as unknown as SessionSnapshot),
    enter(t: number, territoryType: number) {
      r.zone({ territoryType: field(territoryType), mapId: field(1) }, t, carry)
      r.identities('entities', [], [], new Set([1, 2]), 'party', t)
    },
    fight(id: string, start: number, end?: number) {
      r.fightStarted({ id, at: start })
      r.event({ meta: meta(start), value: effect(start) })
      r.event({ meta: meta(start + 500), value: effect(start + 500) })
      if (end === undefined) return
      r.fightEnded({ id, reason: 'quiet', at: end, summary })
      r.flushBoundaries()
    },
  }
}
async function read(log: CombatLog, visit: string) {
  const out: LogRecord[] = []
  for await (const record of log.read(visit)) out.push(record)
  return out
}

describe('combat log', () => {
  it('lists visits and fights from the notes after a restart', async () => {
    const first = open()
    await first.log.open()
    first.source()
    first.enter(T, 1)
    first.fight('enc-1', T + 1000, T + 5000)
    first.enter(T + 60_000, 2)
    first.fight('enc-2', T + 61_000, T + 65_000)
    first.log.recorder.stop(T + 70_000)
    await first.log.flush()
    const second = open(first.memory)
    await second.log.open()
    expect(second.log.list()).toEqual([
      expect.objectContaining({
        id: '20261026-200100-2',
        territoryType: 2,
        self: 1,
        zoneName: '区域2',
        enteredAt: T + 60_000,
        leftAt: T + 70_000,
        endReason: 'stopped',
        current: false,
        integrity: 'unchecked',
        fights: [
          {
            number: 1,
            id: 'enc-2',
            startAt: T + 61_000,
            endAt: T + 65_000,
            reason: 'quiet',
            scope: 'party',
            durationMs: 4000,
            deaths: 1,
            result: 'wipe',
            mainEnemy,
            truncated: false,
            hashed: true,
          },
        ],
      }),
      expect.objectContaining({
        id: '20261026-200000-1',
        endReason: 'zoneChanged',
        leftAt: T + 60_000,
        members: [
          { actorId: 1, name: '同名', worldId: 1, job: 19, jobName: '骑士' },
          { actorId: 2, name: '同名', worldId: 2, job: 24, jobName: null },
        ],
      }),
    ])
    const records = await read(second.log, '20261026-200000-1')
    expect(records.map((record) => record.kind)).toEqual([
      'visitStart',
      'source',
      'carry',
      'identities',
      'zone',
      'identities',
      'fightStart',
      'event',
      'event',
      'fightEnd',
      'visitEnd',
    ])
    expect(second.log.list()[1].integrity).toBe('verified')
  })
  it('reads the visit in progress, including rows not yet written and a fight that just ended', async () => {
    const h = open()
    await h.log.open()
    h.source()
    h.enter(T, 1)
    h.fight('enc-1', T + 1000, T + 5000)
    await h.log.flush()
    h.fight('enc-2', T + 6000, T + 9000)
    expect(h.log.list()[0]).toMatchObject({ current: true, integrity: 'live', fights: [{}, { endAt: T + 9000 }] })
    const records = await read(h.log, '20261026-200000-1')
    expect(records.filter((record) => record.kind === 'fightEnd')).toHaveLength(2)
    expect(records.at(-1)).toMatchObject({ kind: 'fightEnd', id: 'enc-2' })
  })
  it('writes the end of a fight that left combat after the late deaths, or when the next fight or zone comes', async () => {
    const h = open()
    await h.log.open()
    h.source()
    h.enter(T, 1)
    const r = h.log.recorder
    const left = (id: string, start: number) => {
      h.fight(id, start)
      r.fightEnded({ id, reason: 'outOfCombat', at: start + 1000, summary })
      r.flushBoundaries()
    }
    const ends = async () =>
      (await read(h.log, '20261026-200000-1')).flatMap((record, index, all) =>
        record.kind === 'fightEnd' ? [[record.id, all[index - 1].kind]] : [],
      )
    // Waits for deaths up to 5 seconds after the end, then the next input writes it
    left('enc-1', T + 1000)
    r.event({ meta: meta(T + 7000), value: effect(T + 7000) })
    expect(await ends()).toEqual([])
    r.event({ meta: meta(T + 7001), value: effect(T + 7001) })
    expect(await ends()).toEqual([['enc-1', 'event']])
    // A new fight writes it at once
    left('enc-2', T + 10_000)
    h.fight('enc-3', T + 11_500, T + 12_000)
    expect(await ends()).toEqual([
      ['enc-1', 'event'],
      ['enc-2', 'event'],
      ['enc-3', 'event'],
    ])
    // So does leaving the zone
    left('enc-4', T + 20_000)
    h.enter(T + 22_000, 2)
    expect(h.log.list()[1].fights.at(-1)).toMatchObject({ id: 'enc-4', reason: 'outOfCombat', hashed: true })
    expect((await read(h.log, '20261026-200000-1')).slice(-2).map((record) => record.kind)).toEqual([
      'fightEnd',
      'visitEnd',
    ])
  })
  it('writes source clock times and durations with fractional milliseconds as whole ones', async () => {
    const first = open()
    await first.log.open()
    const r = first.log.recorder
    first.source()
    first.enter(T + 0.4, 1)
    r.fightStarted({ id: 'enc-1', at: T + 1000.25 })
    r.event({ meta: meta(T + 1000.6), value: effect(1) })
    r.event({
      meta: meta(T + 1200.5),
      value: {
        type: 'castStarted',
        packet: effect(2).packet,
        data: { ...castSpace, casterId: 9, actionId: 7, targetId: 1, durationMs: 2499.9998 },
      },
    })
    r.event({
      meta: meta(T + 1300.2),
      value: {
        type: 'statusChanged',
        packet: effect(3).packet,
        data: {
          actorId: 9,
          slot: 0,
          status: { statusId: 49, param: 0, sourceActorId: 1, durationMs: 29_999.998, observedAt: T + 1300.2 },
        },
      },
    })
    r.event({ meta: meta(T + 3000.7), value: { type: 'periodicTick', data: tick({ occurredAt: T + 3000.7 }) } })
    r.tick(T + 4000.9)
    r.fightEnded({ id: 'enc-1', reason: 'quiet', at: T + 5000.3, summary })
    r.flushBoundaries()
    first.enter(T + 60_000.5, 2)
    r.stop(T + 70_000.9)
    await first.log.flush()
    expect(first.log.status()).toEqual({ error: null })
    const second = open(first.memory)
    await second.log.open()
    expect(second.log.list()).toMatchObject([
      { territoryType: 2, enteredAt: T + 60_001, leftAt: T + 70_001, endReason: 'stopped' },
      {
        territoryType: 1,
        enteredAt: T,
        leftAt: T + 60_001,
        endReason: 'zoneChanged',
        fights: [{ startAt: T + 1000, endAt: T + 5000, hashed: true }],
      },
    ])
    const records = await read(second.log, '20261026-200000-1')
    const events = records.flatMap((record) => (record.kind === 'event' ? [record.sample] : []))
    expect(events.map((sample) => sample.meta.observedAt)).toEqual([T + 1001, T + 1201, T + 1300, T + 3001])
    expect(events.map((sample) => sample.value)).toMatchObject([
      { type: 'actionEffect' },
      { data: { durationMs: 2500 } },
      { data: { status: { durationMs: 30_000, observedAt: T + 1300 } } },
      { data: { occurredAt: T + 3001 } },
    ])
  })
  it('marks a visit cut off by a crash as interrupted', async () => {
    const first = open()
    await first.log.open()
    first.source()
    first.enter(T, 1)
    first.fight('enc-1', T + 1000, T + 5000)
    first.fight('enc-2', T + 6000)
    await first.log.flush()
    first.log.recorder.event({ meta: meta(T + 7000), value: effect(1) })
    const second = open(first.memory)
    await second.log.open()
    expect(second.log.list()[0]).toMatchObject({
      endReason: 'interrupted',
      leftAt: null,
      fights: [{ hashed: true }, { id: 'enc-2', endAt: null, reason: null, hashed: false }],
    })
    const records = await read(second.log, '20261026-200000-1')
    expect(records.at(-1)).toMatchObject({ kind: 'event' })
  })
  it('fails the visit when a value inside a fight was changed', async () => {
    const first = open()
    await first.log.open()
    first.source()
    first.enter(T, 1)
    first.fight('enc-1', T + 1000, T + 5000)
    first.log.recorder.stop(T + 10_000)
    await first.log.flush()
    const name = 'log/2026-10-26.parquet'
    const parsed = parseFile(first.memory.files.get(name)!)
    const groups = []
    for (let group = 0; group < parsed.groups.length; group++) {
      const columns = await decodeColumns(parsed, group, COLUMN_NAMES)
      const amount = COLUMN_NAMES.indexOf('amount')
      const index = columns[amount].findIndex((cell: Cell) => cell === 100)
      if (index >= 0) columns[amount][index] = 1000
      groups.push(encodeRowGroup(COLUMNS, columns))
    }
    first.memory.files.set(name, buildFile(COLUMNS, groups, parsed.kv, 'test'))
    const second = open(first.memory)
    await second.log.open()
    await expect(read(second.log, '20261026-200000-1')).rejects.toThrow(LogIntegrityError)
    expect(second.log.list()[0]).toMatchObject({ integrity: 'failed', error: '日志校验失败', fights: [] })
    await expect(read(second.log, '20261026-200000-1')).rejects.toThrow(LogIntegrityError)
  })
  it('does not check the hashes of a visit again once it passed', async () => {
    const first = open()
    await first.log.open()
    first.source()
    first.enter(T, 1)
    first.fight('enc-1', T + 1000, T + 5000)
    first.log.recorder.stop(T + 10_000)
    await first.log.flush()
    const second = open(first.memory)
    await second.log.open()
    const visit = '20261026-200000-1'
    const changed = /:1000[,}]/
    expect(JSON.stringify(await read(second.log, visit))).not.toMatch(changed)
    expect(second.log.list()[0].integrity).toBe('verified')
    // Changing a value under the same store would fail the check, so reading it back shows the check was skipped.
    const name = 'log/2026-10-26.parquet'
    const parsed = parseFile(first.memory.files.get(name)!)
    const groups = []
    for (let group = 0; group < parsed.groups.length; group++) {
      const columns = await decodeColumns(parsed, group, COLUMN_NAMES)
      const amount = COLUMN_NAMES.indexOf('amount')
      const index = columns[amount].findIndex((cell: Cell) => cell === 100)
      if (index >= 0) columns[amount][index] = 1000
      groups.push(encodeRowGroup(COLUMNS, columns))
    }
    first.memory.files.set(name, buildFile(COLUMNS, groups, parsed.kv, 'test'))
    expect(JSON.stringify(await read(second.log, visit))).toMatch(changed)
    expect(second.log.list()[0].integrity).toBe('verified')
  })
})
