import type { CombatantState, Status } from '@ffcafe/mojito-plugin-sdk'
import type { AttributionDelta, AttributionPart, DamageAttribution, GameEvent, PeriodicTick } from '../combat-events.js'
import type { Scope } from '../model.js'
import type { Cell, ColumnSpec, Encoding, PhysicalType } from './parquet.js'
import {
  type FightResult,
  type IdentityOrigin,
  type LogEvent,
  LogIntegrityError,
  type LogRecord,
  type MainEnemy,
  type Member,
  type PositionActor,
  type SourceRecord,
  type VisitEndReason,
} from './types.js'

const column = (
  name: string,
  type: PhysicalType,
  encoding: Encoding,
  options: { required?: boolean; utf8?: boolean; uncompressed?: boolean } = {},
): ColumnSpec => ({
  name,
  type,
  utf8: options.utf8 ?? false,
  required: options.required ?? false,
  encoding,
  codec: options.uncompressed ? 'UNCOMPRESSED' : 'GZIP',
})
const delta = (name: string, type: 'INT32' | 'INT64', required = false) =>
  column(name, type, 'DELTA_BINARY_PACKED', { required })
const flag = (name: string) => column(name, 'BOOLEAN', 'PLAIN')
const split = (name: string, type: 'FLOAT' | 'DOUBLE') => column(name, type, 'BYTE_STREAM_SPLIT')

// The order is part of the format: the hash covers rows as arrays in this order.
export const COLUMNS = [
  column('note', 'BYTE_ARRAY', 'PLAIN', { utf8: true, uncompressed: true }),
  column('visit', 'BYTE_ARRAY', 'RLE_DICTIONARY', { utf8: true, required: true }),
  column('kind', 'BYTE_ARRAY', 'RLE_DICTIONARY', { utf8: true, required: true }),
  delta('t', 'INT64', true),
  delta('fight', 'INT32'),
  delta('pseq', 'INT64'),
  delta('pts', 'INT64'),
  delta('psrc', 'INT64'),
  delta('ptgt', 'INT64'),
  delta('actor', 'INT64'),
  delta('target', 'INT64'),
  delta('action', 'INT32'),
  delta('status', 'INT32'),
  delta('seq', 'INT64'),
  delta('index', 'INT32'),
  delta('type', 'INT32'),
  flag('aoe'),
  flag('crit'),
  flag('direct'),
  delta('flags', 'INT64'),
  delta('param', 'INT64'),
  split('amount', 'DOUBLE'),
  delta('bonus', 'INT32'),
  split('unknown', 'DOUBLE'),
  delta('at', 'INT64'),
  delta('duration', 'INT64'),
  flag('flag'),
  flag('confirmed'),
  column('tag', 'BYTE_ARRAY', 'RLE_DICTIONARY', { utf8: true }),
  delta('generation', 'INT32'),
  delta('hpCur', 'INT64'),
  delta('hpMax', 'INT64'),
  split('x', 'FLOAT'),
  split('z', 'FLOAT'),
  split('rotation', 'FLOAT'),
  column('data', 'BYTE_ARRAY', 'PLAIN', { utf8: true }),
  delta('attacker', 'INT64'),
  split('retained', 'DOUBLE'),
] as const satisfies readonly ColumnSpec[]
export type ColumnName = (typeof COLUMNS)[number]['name']
export const COLUMN_NAMES: ColumnName[] = COLUMNS.map((item) => item.name)
export type Row = { [K in ColumnName]?: Cell }

const FLOATS = new Set<string>(COLUMNS.filter((item) => item.type === 'FLOAT').map((item) => item.name))
/** The hashed form of a row; FLOAT columns use the float32 value that the file stores. */
export function canonical(row: Row): string {
  return JSON.stringify(
    COLUMN_NAMES.map((name) => {
      const cell = row[name] ?? null
      return typeof cell === 'number' && FLOATS.has(name) ? Math.fround(cell) : cell
    }),
  )
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0')
export const localDate = (ms: number) => {
  const date = new Date(ms)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
export const localTime = (ms: number) => {
  const date = new Date(ms)
  const offset = -date.getTimezoneOffset()
  const sign = offset < 0 ? '-' : '+'
  return `${localDate(ms)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(
    date.getMilliseconds(),
    3,
  )} ${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
}
export const visitId = (ms: number, territoryType: number) => {
  const date = new Date(ms)
  return `${localDate(ms).replaceAll('-', '')}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(
    date.getSeconds(),
  )}-${territoryType}`
}

// Note builders list keys in the documented order; readers re-serialize the parsed object, so the order is what makes
// the hashed fightEnd note reproducible.
export const visitStartNote = (note: {
  visit: string
  territoryType: number
  zone: string | null
  enteredAt: number
  scope: Scope
  members: Member[]
  self: number | null
}) => ({
  note: 'visitStart' as const,
  visit: note.visit,
  territoryType: note.territoryType,
  zone: note.zone,
  enteredAt: localTime(note.enteredAt),
  scope: note.scope,
  members: note.members.map((member) => ({
    actorId: member.actorId,
    name: member.name,
    worldId: member.worldId,
    job: member.job,
    jobName: member.jobName,
  })),
  self: note.self,
})
export const fightStartNote = (note: {
  visit: string
  fight: number
  id: string
  zone: string | null
  enteredAt: number
  startAt: number
  scope: Scope
}) => ({
  note: 'fightStart' as const,
  visit: note.visit,
  fight: note.fight,
  id: note.id,
  zone: note.zone,
  enteredAt: localTime(note.enteredAt),
  startAt: localTime(note.startAt),
  scope: note.scope,
})
export interface FightEndNote {
  note: 'fightEnd'
  visit: string
  fight: number
  endAt: string
  durationMs: number | null
  reason: string
  result: FightResult | null
  cleared: boolean | null
  mainEnemy: MainEnemy | null
  deaths: number | null
  truncated: boolean
  hash?: string | null
}
export const fightEndNote = (note: {
  visit: string
  fight: number
  endAt: number
  durationMs: number | null
  reason: string
  result: FightResult | null
  mainEnemy: MainEnemy | null
  deaths: number | null
  truncated: boolean
}): FightEndNote => ({
  note: 'fightEnd',
  visit: note.visit,
  fight: note.fight,
  endAt: localTime(note.endAt),
  durationMs: note.durationMs,
  reason: note.reason,
  result: note.result,
  cleared: note.result === null ? null : note.result === 'kill',
  mainEnemy: note.mainEnemy && {
    name: note.mainEnemy.name,
    hpCur: note.mainEnemy.hpCur,
    hpMax: note.mainEnemy.hpMax,
    hpPercent: note.mainEnemy.hpPercent,
  },
  deaths: note.deaths,
  truncated: note.truncated,
})
export const visitEndNote = (note: { visit: string; leftAt: number; reason: VisitEndReason; fights: number }) => ({
  note: 'visitEnd' as const,
  visit: note.visit,
  leftAt: localTime(note.leftAt),
  reason: note.reason,
  fights: note.fights,
})
export type Note =
  | ReturnType<typeof visitStartNote>
  | ReturnType<typeof fightStartNote>
  | FightEndNote
  | ReturnType<typeof visitEndNote>
export const NOTE_KINDS = new Set(['visitStart', 'visitEnd', 'fightStart', 'fightEnd'])
export const noteRow = (note: Note): Row => ({ kind: note.note, note: JSON.stringify(note) })
/** Parses a note cell; a cell that is not one of the four notes means the log was damaged. */
export function parseNote(kind: string, cell: Cell): Note {
  let note: Note | null = null
  try {
    note = JSON.parse(String(cell))
  } catch {
    /* Reported below. */
  }
  if (!note || typeof note !== 'object' || note.note !== kind || typeof note.visit !== 'string')
    throw new LogIntegrityError('日志校验失败：注释无法解析')
  return note
}

export type DataRecord = Exclude<LogRecord, { kind: 'visitStart' | 'fightStart' | 'fightEnd' | 'visitEnd' }>
const json = (value: unknown) => JSON.stringify(value)
// Clock times and durations converted from seconds carry fractions of a millisecond; INT64 columns hold whole ones.
const ms = <T extends number | null>(value: T) => (value === null ? null : Math.round(value)) as T
const packetCells = (event: LogEvent): Row =>
  event.packet
    ? {
        pseq: event.packet.seq,
        pts: event.packet.timestamp,
        psrc: event.packet.sourceActorId,
        ptgt: event.packet.targetActorId,
      }
    : {}
const tickCells = (tick: PeriodicTick): Row => ({
  generation: tick.estimatorGeneration,
  seq: tick.tickId,
  at: ms(tick.occurredAt),
  target: tick.target,
  flag: tick.isHeal,
  status: tick.statusId,
  amount: tick.total,
  unknown: tick.unknown,
  confirmed: tick.confirmed,
  tag: tick.phase,
})
const shareRows = (tick: PeriodicTick): Row[] =>
  tick.shares.map((share) => ({
    kind: 'share',
    actor: share.sourceId,
    status: share.statusId,
    amount: share.amount,
    tag: share.basis,
  }))
const statusCells = (status: Status): Row => ({
  status: status.statusId,
  param: status.param,
  target: status.sourceActorId,
  duration: ms(status.durationMs),
  at: ms(status.observedAt),
})

/** Rows for one record; the caller fills visit, t and fight. */
export function rowsFor(record: DataRecord): Row[] {
  switch (record.kind) {
    case 'source':
    case 'settings':
    case 'carry':
    case 'party':
    case 'zone':
      return [{ kind: record.kind, data: json(record.value) }]
    case 'player':
      return [{ kind: 'player', data: json({ origin: record.origin, value: record.value }) }]
    case 'identities':
      return [
        { kind: 'identities', data: json({ origin: record.origin }) },
        ...record.entities.map(
          ({ id, generation, ...fields }): Row => ({
            kind: 'entity',
            actor: id,
            data: json(fields),
            ...(generation === undefined ? {} : { generation }),
          }),
        ),
        ...record.missing.map((id): Row => ({ kind: 'missing', actor: id })),
      ]
    case 'positions':
      return record.actors.map((actor) => ({
        kind: 'pos',
        actor: actor.id,
        x: actor.x,
        z: actor.z,
        rotation: actor.rotation,
        hpCur: actor.hpCur,
        hpMax: actor.hpMax,
      }))
    case 'event':
      return eventRows(record.sample.value)
  }
}
const partRows = (parts: readonly AttributionPart[]): Row[] =>
  parts.map((part) => ({ kind: 'part', status: part.statusId, actor: part.sourceId, amount: part.amount }))
/** The origin of a split: the action and its sequence, or the tick and its status */
const originCells = (origin: DamageAttribution['origin'] | AttributionDelta['origin']): Row =>
  origin.type === 'action'
    ? { tag: 'action', action: origin.actionId, ...('sequence' in origin ? { param: origin.sequence } : {}) }
    : { tag: 'tick', status: origin.statusId, ...('tickId' in origin ? { param: origin.tickId } : {}) }
function eventRows(event: LogEvent): Row[] {
  const packet = packetCells(event)
  switch (event.type) {
    case 'actionEffect': {
      const { data } = event
      const shared = { actor: data.sourceActorId, action: data.actionId, seq: data.sequence }
      const { sourcePosition, sourceRotation, effectRotation, animationTargetId, effectPosition, dataFlag } = data
      const rows: Row[] = [
        {
          kind: 'action',
          ...packet,
          ...shared,
          type: data.actionType,
          aoe: data.isAoe,
          data: json({ sourcePosition, sourceRotation, effectRotation, animationTargetId, effectPosition, dataFlag }),
        },
      ]
      for (const target of data.targets) {
        rows.push({
          kind: 'target',
          target: target.targetId,
          index: target.targetIndex ?? null,
          data: json(target.targetPosition),
        })
        for (const effect of target.effects)
          rows.push({
            kind: 'effect',
            ...shared,
            target: target.targetId,
            index: effect.effectIndex ?? null,
            type: effect.typeCode,
            crit: effect.critical,
            direct: effect.direct,
            flags: effect.rawFlags,
            param: effect.rawParam,
            amount: effect.rawValue,
            bonus: effect.rawBonusPercent,
          })
      }
      return rows
    }
    case 'periodicTick':
      return [{ kind: 'tick', ...packet, ...tickCells(event.data) }, ...shareRows(event.data)]
    case 'periodicRevision':
      return [
        { kind: 'revision', ...packet, generation: event.data.estimatorGeneration },
        ...event.data.ticks.flatMap((tick) => [{ kind: 'revisionTick', ...tickCells(tick) }, ...shareRows(tick)]),
      ]
    case 'damageAttributed': {
      const { data } = event
      return [
        {
          kind: 'attributed',
          ...packet,
          generation: data.estimatorGeneration,
          seq: data.id,
          ...originCells(data.origin),
          attacker: data.attackerId,
          actor: data.actorId,
          target: data.targetId,
          amount: data.amount,
          retained: data.retained,
          unknown: data.unattributed,
        },
        ...partRows(data.contributions),
      ]
    }
    case 'attributionRevision':
      return [
        { kind: 'attributionRevision', ...packet, generation: event.data.estimatorGeneration },
        ...event.data.records.flatMap((record) => [
          {
            kind: 'delta',
            seq: record.id,
            ...originCells(record.origin),
            param: record.tickId,
            actor: record.actorId,
            unknown: record.unattributed,
          },
          ...partRows(record.contributions),
        ]),
      ]
    case 'potencySample': {
      const { data } = event
      // A potency row takes the columns of the sample by their meaning where it can; retained holds the potency and
      // unknown the multiplier the model knows. Logs of hosts older than Plugin API 1.8.0 have neither critical nor direct,
      // and only samples that are neither. Each factor row that follows holds the source in actor, the
      // multiplier in amount, and in flag whether the target holds the status.
      const { potency, multiplier } = data
      return [
        {
          kind: 'potency',
          ...packet,
          actor: data.casterId,
          target: data.targetId,
          action: data.actionId,
          seq: data.sequence,
          amount: data.amount,
          retained: potency,
          unknown: multiplier,
          crit: data.critical === true,
          direct: data.direct === true,
        },
        ...data.factors.map((factor): Row => {
          const onTarget = factor.holder === 'target'
          return {
            kind: 'factor',
            status: factor.statusId,
            actor: factor.sourceId,
            amount: factor.value,
            flag: onTarget,
          }
        }),
      ]
    }
    case 'playerCombatChanged':
      return [{ kind: 'combat', ...packet, actor: event.data.actorId, flag: event.data.inCombat }]
    case 'castStarted':
      return [
        {
          kind: 'castStart',
          ...packet,
          actor: event.data.casterId,
          action: event.data.actionId,
          target: event.data.targetId,
          duration: ms(event.data.durationMs),
          data: json({
            sourcePosition: event.data.sourcePosition,
            sourceRotation: event.data.sourceRotation,
            targetPosition: event.data.targetPosition,
            castPosition: event.data.castPosition,
            castRotation: event.data.castRotation,
          }),
        },
      ]
    case 'castCancelled':
      return [
        {
          kind: 'castCancel',
          ...packet,
          actor: event.data.casterId,
          action: event.data.actionId,
          flag: event.data.interrupted,
        },
      ]
    case 'actorDied':
      return [{ kind: 'died', ...packet, actor: event.data.actorId, target: event.data.causedByActorId }]
    case 'statusesReplaced':
      return [
        { kind: 'statuses', ...packet, actor: event.data.actorId },
        ...event.data.statuses.map((status): Row => ({ kind: 'statusItem', ...statusCells(status) })),
      ]
    case 'statusChanged':
      return [
        {
          kind: 'status',
          ...packet,
          actor: event.data.actorId,
          index: event.data.slot,
          ...(event.data.status ? statusCells(event.data.status) : {}),
        },
      ]
    case 'zoneChanged':
      return [{ kind: 'zoneEvent', ...packet, data: json({ territoryTypeId: event.data.territoryTypeId }) }]
    case 'hpChanged':
      return [
        {
          kind: 'hp',
          ...packet,
          actor: event.data.actorId,
          hpCur: event.data.hpCur,
          hpMax: event.data.hpMax,
          seq: event.data.sequence,
          tag: event.data.origin,
        },
      ]
    case 'targetableChanged':
      return [{ kind: 'targetable', ...packet, actor: event.data.actorId, flag: event.data.targetable }]
    case 'cutsceneChanged':
      return [{ kind: 'cutscene', ...packet, flag: event.data.playing }]
    default:
      throw new LogIntegrityError(`日志不支持事件类型：${event.type}`)
  }
}

const num = (row: Row, name: ColumnName) => (row[name] ?? null) as number | null
const bool = (row: Row, name: ColumnName) => (row[name] ?? null) as boolean
const text = (row: Row, name: ColumnName) => (row[name] ?? null) as string | null
const parse = <T>(row: Row): T => {
  try {
    return JSON.parse(String(row.data))
  } catch {
    throw new LogIntegrityError(`日志校验失败：${String(row.kind)} 行的数据无法解析`)
  }
}
const packetOf = (row: Row) =>
  row.pseq === null || row.pseq === undefined
    ? undefined
    : {
        seq: num(row, 'pseq')!,
        timestamp: num(row, 'pts')!,
        sourceActorId: num(row, 'psrc')!,
        targetActorId: num(row, 'ptgt')!,
      }
const withPacket = <T extends object>(row: Row, event: T) => {
  const packet = packetOf(row)
  return (packet ? { ...event, packet } : event) as unknown as LogEvent
}
const tickOf = (row: Row): PeriodicTick => ({
  estimatorGeneration: num(row, 'generation')!,
  tickId: num(row, 'seq')!,
  occurredAt: num(row, 'at')!,
  target: num(row, 'target'),
  isHeal: bool(row, 'flag'),
  statusId: num(row, 'status')!,
  total: num(row, 'amount')!,
  unknown: num(row, 'unknown')!,
  confirmed: bool(row, 'confirmed'),
  phase: text(row, 'tag') as PeriodicTick['phase'],
  shares: [],
})
const partOf = (row: Row): AttributionPart => ({
  statusId: num(row, 'status')!,
  sourceId: num(row, 'actor'),
  amount: num(row, 'amount')!,
})
const statusOf = (row: Row): Status => ({
  statusId: num(row, 'status')!,
  param: num(row, 'param')!,
  sourceActorId: num(row, 'target'),
  durationMs: num(row, 'duration'),
  observedAt: num(row, 'at')!,
})

type Pending =
  | { kind: 'event'; t: number; event: LogEvent }
  | {
      kind: 'identities'
      origin: IdentityOrigin
      entities: (CombatantState & { generation?: number })[]
      missing: number[]
    }
  | { kind: 'positions'; t: number; actors: PositionActor[] }

/** Turns rows back into records; a record with child rows is emitted once its next header row arrives. */
export class Assembler {
  private pending: Pending | null = null
  private source: SourceRecord | null = null
  private fights = new Map<number, string>()
  push(row: Row): LogRecord[] {
    const kind = String(row.kind)
    const t = num(row, 't')!
    const child = this.child(kind, row, t)
    if (child) return []
    const out = this.flush()
    const record = this.header(kind, row, t)
    if (record) out.push(record)
    return out
  }
  flush(): LogRecord[] {
    const pending = this.pending
    this.pending = null
    if (!pending) return []
    if (pending.kind === 'event') return [{ kind: 'event', sample: this.sample(pending.t, pending.event) }]
    return [pending]
  }
  private sample(t: number, value: LogEvent) {
    const source = this.source
    if (!source || source.sessionId === null) throw new LogIntegrityError('日志校验失败：事件之前没有数据来源记录')
    return {
      meta: {
        sessionId: source.sessionId,
        characterGeneration: source.characterGeneration,
        clockGeneration: source.clockGeneration,
        source: source.source ?? (source.state === 'replay' ? 'replay' : 'live'),
        observedAt: t,
        timeBase: source.timeBase ?? 'packet-unix',
        sampleStartedAt: null,
        sampleEndedAt: null,
      },
      value,
    }
  }
  private orphan(kind: string): never {
    throw new LogIntegrityError(`日志校验失败：${kind} 行没有所属的记录`)
  }
  /** Attaches a child row to the pending record; returns false for header rows. */
  private child(kind: string, row: Row, t: number): boolean {
    const pending = this.pending
    const event = pending?.kind === 'event' ? pending.event : null
    switch (kind) {
      case 'target':
        if (event?.type !== 'actionEffect') this.orphan(kind)
        event.data.targets.push({
          ...(row.index === null || row.index === undefined ? {} : { targetIndex: num(row, 'index')! }),
          targetId: num(row, 'target'),
          targetPosition: parse<GameEvent<'actionEffect'>['data']['targets'][number]['targetPosition']>(row),
          // The log does not keep the entries: its results are logged with it
          rawEntries: [],
          effects: [],
        })
        return true
      case 'effect': {
        const target = event?.type === 'actionEffect' ? event.data.targets.at(-1) : undefined
        if (!target) this.orphan(kind)
        target.effects.push({
          ...(row.index === null || row.index === undefined ? {} : { effectIndex: num(row, 'index')! }),
          typeCode: num(row, 'type')!,
          critical: bool(row, 'crit'),
          direct: bool(row, 'direct'),
          rawFlags: num(row, 'flags')!,
          rawParam: num(row, 'param')!,
          rawValue: num(row, 'amount')!,
          rawBonusPercent: num(row, 'bonus')!,
        })
        return true
      }
      case 'revisionTick':
        if (event?.type !== 'periodicRevision') this.orphan(kind)
        event.data.ticks.push(tickOf(row))
        return true
      case 'share': {
        const tick =
          event?.type === 'periodicTick'
            ? event.data
            : event?.type === 'periodicRevision'
              ? event.data.ticks.at(-1)
              : undefined
        if (!tick) this.orphan(kind)
        tick.shares.push({
          sourceId: num(row, 'actor'),
          statusId: num(row, 'status')!,
          amount: num(row, 'amount')!,
          basis: text(row, 'tag') as PeriodicTick['shares'][number]['basis'],
        })
        return true
      }
      case 'delta':
        if (event?.type !== 'attributionRevision') this.orphan(kind)
        event.data.records.push({
          id: num(row, 'seq'),
          tickId: num(row, 'param'),
          actorId: num(row, 'actor'),
          origin:
            text(row, 'tag') === 'action'
              ? { type: 'action', actionId: num(row, 'action')! }
              : { type: 'tick', statusId: num(row, 'status')! },
          unattributed: num(row, 'unknown')!,
          contributions: [],
        })
        return true
      case 'part': {
        const parts =
          event?.type === 'damageAttributed'
            ? event.data.contributions
            : event?.type === 'attributionRevision'
              ? event.data.records.at(-1)?.contributions
              : undefined
        if (!parts) this.orphan(kind)
        parts.push(partOf(row))
        return true
      }
      case 'factor': {
        if (event?.type !== 'potencySample') this.orphan(kind)
        // See eventRows: actor is the source, amount the multiplier, flag whether the target holds the status
        const onTarget = bool(row, 'flag')
        event.data.factors.push({
          statusId: num(row, 'status')!,
          sourceId: num(row, 'actor'),
          holder: onTarget ? 'target' : 'caster',
          value: num(row, 'amount')!,
        })
        return true
      }
      case 'statusItem':
        if (event?.type !== 'statusesReplaced') this.orphan(kind)
        event.data.statuses.push(statusOf(row))
        return true
      case 'entity':
        if (pending?.kind !== 'identities') this.orphan(kind)
        pending.entities.push({
          id: num(row, 'actor')!,
          ...parse<Omit<CombatantState, 'id'>>(row),
          ...(row.generation === null || row.generation === undefined ? {} : { generation: num(row, 'generation')! }),
        })
        return true
      case 'missing':
        if (pending?.kind !== 'identities') this.orphan(kind)
        pending.missing.push(num(row, 'actor')!)
        return true
      case 'pos':
        if (pending?.kind !== 'positions' || pending.t !== t) return false
        pending.actors.push(this.position(row))
        return true
    }
    return false
  }
  private position(row: Row): PositionActor {
    return {
      id: num(row, 'actor')!,
      x: num(row, 'x')!,
      z: num(row, 'z')!,
      rotation: num(row, 'rotation')!,
      hpCur: num(row, 'hpCur'),
      hpMax: num(row, 'hpMax'),
    }
  }
  private event(t: number, event: LogEvent): null {
    this.pending = { kind: 'event', t, event }
    return null
  }
  private header(kind: string, row: Row, t: number): LogRecord | null {
    if (NOTE_KINDS.has(kind)) return this.note(kind, row, t)
    switch (kind) {
      case 'source':
        this.source = parse(row)
        return { kind, value: this.source! }
      case 'settings':
      case 'carry':
      case 'party':
        return { kind, value: parse(row) } as LogRecord
      case 'zone':
        return { kind, value: parse(row), t }
      case 'player': {
        const data = parse<{ origin: 'watch' | 'get'; value: object }>(row)
        return { kind, origin: data.origin, value: data.value, t }
      }
      case 'identities':
        this.pending = { kind, origin: parse<{ origin: IdentityOrigin }>(row).origin, entities: [], missing: [] }
        return null
      case 'pos':
        this.pending = { kind: 'positions', t, actors: [this.position(row)] }
        return null
      case 'action':
        return this.event(
          t,
          withPacket(row, {
            type: 'actionEffect',
            data: {
              ...parse<
                Pick<
                  GameEvent<'actionEffect'>['data'],
                  | 'sourcePosition'
                  | 'sourceRotation'
                  | 'effectRotation'
                  | 'animationTargetId'
                  | 'effectPosition'
                  | 'dataFlag'
                >
              >(row),
              sourceActorId: num(row, 'actor'),
              actionId: num(row, 'action')!,
              actionType: num(row, 'type')!,
              sequence: num(row, 'seq')!,
              isAoe: bool(row, 'aoe'),
              targets: [],
            },
          }),
        )
      case 'tick':
        return this.event(t, withPacket(row, { type: 'periodicTick', data: tickOf(row) }))
      case 'revision':
        return this.event(
          t,
          withPacket(row, {
            type: 'periodicRevision',
            data: { estimatorGeneration: num(row, 'generation')!, ticks: [] },
          }),
        )
      case 'attributed':
        return this.event(
          t,
          withPacket(row, {
            type: 'damageAttributed',
            data: {
              estimatorGeneration: num(row, 'generation')!,
              id: num(row, 'seq')!,
              origin:
                text(row, 'tag') === 'action'
                  ? { type: 'action', actionId: num(row, 'action')!, sequence: num(row, 'param')! }
                  : { type: 'tick', tickId: num(row, 'param')!, statusId: num(row, 'status')! },
              attackerId: num(row, 'attacker'),
              actorId: num(row, 'actor'),
              targetId: num(row, 'target'),
              amount: num(row, 'amount')!,
              retained: num(row, 'retained')!,
              unattributed: num(row, 'unknown')!,
              contributions: [],
            },
          }),
        )
      case 'attributionRevision':
        return this.event(
          t,
          withPacket(row, {
            type: 'attributionRevision',
            data: { estimatorGeneration: num(row, 'generation')!, records: [] },
          }),
        )
      case 'potency': {
        // See eventRows: retained is the potency, unknown the multiplier the model knows
        const potency = num(row, 'retained')!
        const multiplier = num(row, 'unknown')!
        return this.event(
          t,
          withPacket(row, {
            type: 'potencySample',
            data: {
              casterId: num(row, 'actor'),
              targetId: num(row, 'target'),
              actionId: num(row, 'action')!,
              sequence: num(row, 'seq')!,
              amount: num(row, 'amount')!,
              potency,
              multiplier,
              factors: [],
              // Logs before the flags have them empty, and their samples are neither
              critical: bool(row, 'crit') === true,
              direct: bool(row, 'direct') === true,
            },
          }),
        )
      }
      case 'statuses':
        return this.event(
          t,
          withPacket(row, { type: 'statusesReplaced', data: { actorId: num(row, 'actor'), statuses: [] } }),
        )
      case 'combat':
        return this.event(
          t,
          withPacket(row, {
            type: 'playerCombatChanged',
            data: { actorId: num(row, 'actor')!, inCombat: bool(row, 'flag') },
          }),
        )
      case 'castStart':
        return this.event(
          t,
          withPacket(row, {
            type: 'castStarted',
            data: {
              ...parse<
                Pick<
                  GameEvent<'castStarted'>['data'],
                  'sourcePosition' | 'sourceRotation' | 'targetPosition' | 'castPosition' | 'castRotation'
                >
              >(row),
              casterId: num(row, 'actor'),
              actionId: num(row, 'action')!,
              targetId: num(row, 'target'),
              durationMs: num(row, 'duration')!,
            },
          }),
        )
      case 'castCancel':
        return this.event(
          t,
          withPacket(row, {
            type: 'castCancelled',
            data: { casterId: num(row, 'actor'), actionId: num(row, 'action')!, interrupted: bool(row, 'flag') },
          }),
        )
      case 'died':
        return this.event(
          t,
          withPacket(row, {
            type: 'actorDied',
            data: { actorId: num(row, 'actor'), causedByActorId: num(row, 'target') },
          }),
        )
      case 'status':
        return this.event(
          t,
          withPacket(row, {
            type: 'statusChanged',
            data: {
              actorId: num(row, 'actor'),
              slot: num(row, 'index')!,
              status: row.status === null || row.status === undefined ? null : statusOf(row),
            },
          }),
        )
      case 'zoneEvent':
        return this.event(
          t,
          withPacket(row, {
            type: 'zoneChanged',
            data: { territoryTypeId: parse<{ territoryTypeId: number }>(row).territoryTypeId },
          }),
        )
      case 'hp':
        return this.event(
          t,
          withPacket(row, {
            type: 'hpChanged',
            data: {
              origin: text(row, 'tag') as GameEvent<'hpChanged'>['data']['origin'],
              actorId: num(row, 'actor'),
              hpCur: num(row, 'hpCur')!,
              hpMax: num(row, 'hpMax'),
              sequence: num(row, 'seq'),
            },
          }),
        )
      case 'targetable':
        return this.event(
          t,
          withPacket(row, {
            type: 'targetableChanged',
            data: { actorId: num(row, 'actor')!, targetable: bool(row, 'flag') },
          }),
        )
      case 'cutscene':
        return this.event(t, withPacket(row, { type: 'cutsceneChanged', data: { playing: bool(row, 'flag') } }))
    }
    throw new LogIntegrityError(`日志校验失败：无法识别的行 ${kind}`)
  }
  private note(kind: string, row: Row, t: number): LogRecord {
    const note = parseNote(kind, row.note ?? null)
    switch (note.note) {
      case 'visitStart':
        return {
          kind: 'visitStart',
          visit: note.visit,
          territoryType: note.territoryType,
          zoneName: note.zone,
          enteredAt: t,
          scope: note.scope,
          members: note.members,
        }
      case 'fightStart':
        this.fights.set(note.fight, note.id)
        return { kind: 'fightStart', fight: note.fight, id: note.id, startAt: t, scope: note.scope }
      case 'fightEnd':
        return {
          kind: 'fightEnd',
          fight: note.fight,
          id: this.fights.get(note.fight) ?? '',
          endAt: t,
          reason: note.reason,
        }
      case 'visitEnd':
        return { kind: 'visitEnd', leftAt: t, reason: note.reason }
    }
  }
}
