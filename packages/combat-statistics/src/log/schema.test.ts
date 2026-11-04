import type { Field } from '@ffcafe/mojito-plugin-sdk'
import { describe, expect, it } from 'vitest'
import { castSpace, effect, meta, tick, unobserved } from '../fixtures.js'
import {
  Assembler,
  canonical,
  type DataRecord,
  fightEndNote,
  fightStartNote,
  localDate,
  localTime,
  noteRow,
  type Row,
  rowsFor,
  visitEndNote,
  visitId,
  visitStartNote,
} from './schema.js'
import { type LogEvent, LogIntegrityError, type LogRecord, type SourceRecord } from './types.js'

const field = <T>(value: T): Extract<Field<T>, { state: 'ok' }> => ({
  state: 'ok',
  value,
  observedAt: 5,
  from: 'packet',
  timeBase: 'packet-unix',
})
const source: SourceRecord = {
  sessionId: 'source',
  characterGeneration: 1,
  clockGeneration: 1,
  source: 'replay',
  timeBase: 'packet-unix',
  state: 'replay',
  actorId: 1,
  dataLanguage: 'chs',
}
const packet = { seq: 7, timestamp: 1000, sourceActorId: 1, targetActorId: 9 }
const event = (value: LogEvent, at = 1000): Extract<LogRecord, { kind: 'event' }> => ({
  kind: 'event',
  sample: { meta: meta(at), value },
})
const status = { statusId: 49, param: 3, sourceActorId: 1, durationMs: 15000, observedAt: 990 }

function roundTrip(records: LogRecord[]) {
  const rows: Row[] = []
  for (const record of records) {
    if (record.kind === 'event')
      rows.push(...rowsFor(record).map((row) => ({ ...row, visit: 'v', t: record.sample.meta.observedAt })))
    else if (record.kind === 'positions')
      rows.push(...rowsFor(record).map((row) => ({ ...row, visit: 'v', t: record.t })))
    else if (record.kind === 'visitStart' || record.kind === 'fightStart' || record.kind === 'fightEnd') continue
    else if (record.kind === 'visitEnd') continue
    else rows.push(...rowsFor(record).map((row) => ({ ...row, visit: 'v', t: 1 })))
  }
  const assembler = new Assembler()
  return [...rows.flatMap((row) => assembler.push(row)), ...assembler.flush()]
}

describe('rows', () => {
  it('reads back every record kind', () => {
    const multi = effect(1)
    multi.data.targets.push(
      { targetPosition: unobserved, targetId: 10, effects: [] },
      {
        targetPosition: unobserved,
        targetId: null,
        effects: [
          {
            typeCode: 4,
            critical: true,
            direct: true,
            rawFlags: 2 ** 40,
            rawParam: 7,
            rawValue: 12.5,
            rawBonusPercent: 3,
          },
        ],
      },
    )
    const records: LogRecord[] = [
      { kind: 'source', value: source },
      { kind: 'settings', value: { mode: 'auto', quietSeconds: 10, mergePets: true, scope: 'party' } },
      {
        kind: 'carry',
        value: {
          encounters: {
            localActorId: 1,
            inCombat: null,
            combatValue: null,
            packetSeq: null,
            combatSeq: 3,
            combatAt: null,
          },
          generations: [[9, 2]],
        },
      },
      { kind: 'player', origin: 'watch', value: { actorId: field(1), name: field('Alice') }, t: 1 },
      {
        kind: 'party',
        value: { isInParty: field(true), members: field([{ slot: 0, id: 1, name: 'Alice', ownParty: true }]) },
      },
      { kind: 'zone', value: { territoryType: field(1263), mapId: { state: 'unknown', reason: 'x' } }, t: 1 },
      {
        kind: 'identities',
        origin: 'snapshot',
        entities: [
          { id: 1, name: field('Alice'), homeWorldId: field(79), generation: 0 },
          { id: 9, bNpcBase: field(5), ownerId: field(null), generation: 2 },
        ],
        missing: [],
      },
      { kind: 'identities', origin: 'entities', entities: [{ id: 3, ownerId: field(1) }], missing: [4, 5] },
      { kind: 'identities', origin: 'combatants', entities: [], missing: [] },
      event({ ...multi, packet }),
      event({ type: 'periodicTick', data: tick() }, 1001),
      event({ type: 'periodicTick', packet, data: tick({ target: null, phase: 'post', shares: [] }) }, 1002),
      event(
        {
          type: 'periodicRevision',
          data: {
            estimatorGeneration: 2,
            ticks: [tick({ tickId: 1 }), tick({ tickId: 2, isHeal: true, confirmed: false })],
          },
        },
        1003,
      ),
      event({ type: 'playerCombatChanged', packet, data: { actorId: 1, inCombat: true } }),
      event({
        type: 'castStarted',
        packet,
        data: { ...castSpace, casterId: 9, actionId: 300, targetId: null, durationMs: 4700 },
      }),
      event({ type: 'castCancelled', packet, data: { casterId: null, actionId: 300, interrupted: true } }),
      event({ type: 'actorDied', packet, data: { actorId: 1, causedByActorId: 9 } }),
      event({
        type: 'statusesReplaced',
        packet,
        data: { actorId: 1, statuses: [status, { ...status, statusId: 50 }] },
      }),
      event({ type: 'statusesReplaced', packet, data: { actorId: 1, statuses: [] } }),
      event({ type: 'statusChanged', packet, data: { actorId: 1, slot: 4, status } }),
      event({ type: 'statusChanged', packet, data: { actorId: 1, slot: 4, status: null } }),
      event({ type: 'zoneChanged', packet, data: { territoryTypeId: 1263 } }),
      event({
        type: 'hpChanged',
        packet,
        data: { origin: 'effectResult' as const, actorId: 1, hpCur: 6000, hpMax: 10000, sequence: 42 },
      }),
      event({
        type: 'hpChanged',
        packet,
        data: { origin: 'effectResult' as const, actorId: 1, hpCur: 6000, hpMax: null, sequence: null },
      }),
      event({ type: 'targetableChanged', data: { actorId: 9, targetable: true } }),
      event({ type: 'targetableChanged', data: { actorId: 9, targetable: false } }),
      event({ type: 'cutsceneChanged', data: { playing: true } }),
      event({ type: 'cutsceneChanged', data: { playing: false } }),
      {
        kind: 'positions',
        t: 2000,
        actors: [
          { id: 1, x: 100.5, z: -3.25, rotation: 1.5, hpCur: 10, hpMax: 20 },
          { id: 9, x: 0, z: 0, rotation: -0.5, hpCur: null, hpMax: null },
        ],
      },
      { kind: 'positions', t: 2250, actors: [{ id: 1, x: 1, z: 2, rotation: 0.25, hpCur: 10, hpMax: 20 }] },
    ]
    expect(roundTrip(records)).toEqual(records)
  })
  it('preserves packet space separately from sampled space and HP origins', () => {
    const hit = effect(1)
    hit.data.sourcePosition = { ...field({ x: 1, y: 2, z: 3 }), from: 'memory', observedAt: 900 }
    hit.data.sourceRotation = field(0)
    hit.data.effectPosition = field({ x: 0, y: 0, z: 0 })
    hit.data.effectRotation = field(0.5)
    hit.data.animationTargetId = 9
    hit.data.dataFlag = 1
    hit.data.targets[0].targetPosition = { state: 'unavailable', reason: 'No target observation' }
    const records: LogRecord[] = [
      { kind: 'source', value: source },
      event(hit),
      event({
        type: 'castStarted',
        packet,
        data: {
          ...castSpace,
          casterId: 1,
          actionId: 10,
          targetId: 9,
          durationMs: 1000,
          sourcePosition: hit.data.sourcePosition,
          castPosition: hit.data.effectPosition,
          castRotation: field(0),
        },
      }),
      ...(['effectResult', 'effectResultBasic', 'hpUpdate'] as const).map((origin) =>
        event({ type: 'hpChanged', packet, data: { origin, actorId: 9, hpCur: 0, hpMax: null, sequence: null } }),
      ),
    ]
    expect(roundTrip(records)).toEqual(records)
  })
  it('reads notes into records with the times from the t column', () => {
    const rows: Row[] = [
      {
        ...noteRow(
          visitStartNote({
            visit: 'v',
            territoryType: 1263,
            zone: '登天斗技场',
            enteredAt: 100,
            scope: 'party',
            members: [{ actorId: 1, name: null, worldId: 79, job: 19, jobName: '骑士' }],
          }),
        ),
        visit: 'v',
        t: 100,
      },
      {
        ...noteRow(
          fightStartNote({
            visit: 'v',
            fight: 1,
            id: 'enc-1',
            zone: null,
            enteredAt: 100,
            startAt: 200,
            scope: 'all',
          }),
        ),
        visit: 'v',
        t: 200,
        fight: 1,
      },
      {
        ...noteRow({
          ...fightEndNote({
            visit: 'v',
            fight: 1,
            endAt: 300,
            durationMs: 100,
            reason: 'quiet',
            result: null,
            mainEnemy: null,
            deaths: 0,
            truncated: false,
          }),
          hash: null,
        }),
        visit: 'v',
        t: 300,
        fight: 1,
      },
      { ...noteRow(visitEndNote({ visit: 'v', leftAt: 400, reason: 'stopped', fights: 1 })), visit: 'v', t: 400 },
    ]
    const assembler = new Assembler()
    expect(rows.flatMap((row) => assembler.push(row))).toEqual([
      {
        kind: 'visitStart',
        visit: 'v',
        territoryType: 1263,
        zoneName: '登天斗技场',
        enteredAt: 100,
        scope: 'party',
        members: [{ actorId: 1, name: null, worldId: 79, job: 19, jobName: '骑士' }],
      },
      { kind: 'fightStart', fight: 1, id: 'enc-1', startAt: 200, scope: 'all' },
      { kind: 'fightEnd', fight: 1, id: 'enc-1', endAt: 300, reason: 'quiet' },
      { kind: 'visitEnd', leftAt: 400, reason: 'stopped' },
    ])
  })
  it('rejects damaged notes and orphan child rows', () => {
    expect(() => new Assembler().push({ kind: 'fightEnd', note: '{"note":', visit: 'v', t: 1 })).toThrow(
      LogIntegrityError,
    )
    expect(() => new Assembler().push({ kind: 'effect', visit: 'v', t: 1 })).toThrow(LogIntegrityError)
    expect(() => new Assembler().push({ ...rowsFor(event(effect(1)))[0], visit: 'v', t: 1 })).not.toThrow()
  })
  it('reads back the splits of the host and their deltas', () => {
    const records: LogRecord[] = [
      { kind: 'source', value: source },
      event({
        type: 'damageAttributed',
        packet,
        data: {
          estimatorGeneration: 2,
          id: 41,
          origin: { type: 'action', actionId: 10, sequence: 42 },
          attackerId: 1,
          actorId: 3,
          targetId: 9,
          amount: 10000,
          retained: 9123.456789,
          unattributed: 0.25,
          contributions: [
            { statusId: 786, sourceId: 2, amount: 500.125 },
            { statusId: 1878, sourceId: 4, amount: 376.168211 },
          ],
        },
      }),
      event({
        type: 'damageAttributed',
        data: {
          estimatorGeneration: 2,
          id: 42,
          origin: { type: 'tick', tickId: 8, statusId: 1228 },
          attackerId: null,
          actorId: 1,
          targetId: null,
          amount: 300,
          retained: 300,
          unattributed: 0,
          contributions: [],
        },
      }),
      event(
        {
          type: 'attributionRevision',
          data: {
            estimatorGeneration: 2,
            records: [
              {
                id: 41,
                tickId: null,
                actorId: 3,
                origin: { type: 'action', actionId: 10 },
                unattributed: -0.125,
                contributions: [{ statusId: 786, sourceId: 2, amount: -12.5 }],
              },
              {
                id: null,
                tickId: 8,
                actorId: 1,
                origin: { type: 'tick', statusId: 1228 },
                unattributed: 0,
                contributions: [
                  { statusId: 786, sourceId: 2, amount: 4 },
                  { statusId: 1878, sourceId: null, amount: 1.5 },
                ],
              },
            ],
          },
        },
        2000,
      ),
    ]
    expect(roundTrip(records)).toEqual(records)
  })
  it('reads back potency samples with and without factors, and without the flags as neither critical nor direct', () => {
    const records: LogRecord[] = [
      { kind: 'source', value: source },
      event({
        type: 'potencySample',
        packet,
        data: {
          casterId: 1,
          targetId: 9,
          actionId: 7477,
          sequence: 42,
          amount: 9540,
          potency: 200,
          multiplier: 1.1236,
          factors: [
            { statusId: 1878, sourceId: 2, holder: 'caster', value: 1.06 },
            { statusId: 1221, sourceId: null, holder: 'target', value: 1.06 },
          ],
          critical: true,
          direct: false,
        },
      }),
      event(
        {
          type: 'potencySample',
          packet,
          data: {
            casterId: 1,
            targetId: null,
            actionId: 7477,
            sequence: 43,
            amount: 9000,
            potency: 216,
            multiplier: 1,
            factors: [],
          },
        },
        2000,
      ),
    ]
    const read = roundTrip(records)
    expect(read.slice(0, 2)).toEqual(records.slice(0, 2))
    expect(read[2]).toMatchObject({ sample: { value: { data: { critical: false, direct: false } } } })
    const rows = rowsFor(records[1] as DataRecord)
    expect(rows.map((row) => row.kind)).toEqual(['potency', 'factor', 'factor'])
    expect(rows[0]).toMatchObject({ retained: 200, unknown: 1.1236, crit: true, direct: false })
    expect(rows[2]).toMatchObject({ status: 1221, actor: null, amount: 1.06, flag: true })
    // Writing the records read back gives the same hashed rows
    const hashed = (record: LogRecord) =>
      rowsFor(record as DataRecord).map((row) => canonical({ ...row, visit: 'v', t: 1 }))
    expect(read.slice(1).flatMap(hashed)).toEqual(records.slice(1).flatMap(hashed))
  })
  it('rejects a factor row without its potency row', () => {
    expect(() => new Assembler().push({ kind: 'factor', visit: 'v', t: 1, status: 1878, amount: 1.06 })).toThrow(
      LogIntegrityError,
    )
    const assembler = new Assembler()
    assembler.push({ kind: 'source', visit: 'v', t: 1, data: JSON.stringify(source) })
    assembler.push({ ...rowsFor(event(effect(1)))[0], visit: 'v', t: 1 })
    expect(() => assembler.push({ kind: 'factor', visit: 'v', t: 1, status: 1878, amount: 1.06 })).toThrow(
      LogIntegrityError,
    )
  })
  it('gives a fixed canonical form', () => {
    expect(canonical({ kind: 'pos', visit: 'v', t: 5, actor: 1, x: 0.1, data: '{"a":"中"}' })).toBe(
      `[null,"v","pos",5,null,null,null,null,null,1,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,${Math.fround(0.1)},null,null,"{\\"a\\":\\"中\\"}",null,null]`,
    )
  })
  it('formats local times with the local offset', () => {
    const ms = new Date(2026, 9, 26, 20, 5, 12, 345).getTime()
    const offset = -new Date(ms).getTimezoneOffset()
    const sign = offset < 0 ? '-' : '+'
    const hh = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0'),
      mm = String(Math.abs(offset) % 60).padStart(2, '0')
    expect(localTime(ms)).toBe(`2026-10-26 20:05:12.345 ${sign}${hh}:${mm}`)
    expect(localDate(ms)).toBe('2026-10-26')
    expect(visitId(ms, 1263)).toBe('20261026-200512-1263')
  })
})
