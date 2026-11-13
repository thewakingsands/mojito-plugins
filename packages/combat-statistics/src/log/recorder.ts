import type { CombatantState, Field, GameTopics, PlayerState, Sample, SessionSnapshot } from '@ffcafe/mojito-plugin-sdk'
import { value } from '../identity.js'
import { type Actor, LATE_DEATH_MS, type Scope, type Settings, type Summary } from '../model.js'
import { FightHash } from './hash.js'
import {
  type DataRecord,
  fightEndNote,
  fightStartNote,
  noteRow,
  type Row,
  rowsFor,
  visitEndNote,
  visitId,
  visitStartNote,
} from './schema.js'
import type {
  Carry,
  FightEntry,
  FightResult,
  IdentityOrigin,
  LogEvent,
  MainEnemy,
  Member,
  PositionActor,
  SourceRecord,
  VisitEndReason,
  VisitEntry,
} from './types.js'

export interface RecorderSink {
  beginVisit(visit: string, enteredAt: number): void
  append(row: Row): void
  /** Ends the current row group. */
  cut(): void
  fightStarted(): void
  /** Whether the current fight was cut off because it alone exceeds the file limit. */
  fightTruncated(): boolean
  fightEnded(): void
  endVisit(): void
}
export interface RecorderOptions {
  sink: RecorderSink
  actors: () => ReadonlyMap<number, Actor>
  names: { zone(id: number): string | null; job(id: number): string | null }
  brief: (summary: Summary) => { result: FightResult | null; mainEnemy: MainEnemy | null }
  /** Called with the actors whose positions to sample, or null to stop sampling. */
  positions: (ids: number[] | null) => void
}

const IDENTITY_FIELDS = ['name', 'homeWorldId', 'classJob', 'ownerId', 'objectKind', 'subKind', 'bNpcBase'] as const
type IdentityFields = Omit<CombatantState, 'id'>
// Identities keeps the last known name, world, job, object kind and sub kind when a later sample lacks them; owner and NPC base
// always follow the latest sample. The snapshot merges the same way so a replay classifies actors identically.
const STICKY = new Set<string>(['name', 'homeWorldId', 'classJob', 'objectKind', 'subKind'])
const RELEASE_AFTER_MS = 10_000
const GROUP_SPAN_MS = 120_000
// The source clock advances by fractions of a millisecond between samples, while the t column holds whole ones.
const ms = Math.round

/** A record value without the observation times of its fields, which change on every push even when nothing else does. */
function signature(value: object): string {
  const entries = Object.entries(value)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, field]) => {
      if (field === null || typeof field !== 'object' || !('state' in field)) return [name, field]
      const rest: Record<string, unknown> = { ...field }
      delete rest.observedAt
      return [name, rest]
    })
  return JSON.stringify(entries)
}

type Boundary =
  | { kind: 'start'; id: string; at: number }
  | { kind: 'end'; id: string; reason: string; at: number; summary: Summary; afterInput: boolean }
interface Visit {
  id: string
  territoryType: number
  enteredAt: number
  scope: Scope
  released: boolean
  /** Snapshot rows taken on entry, written right after visitStart. */
  snapshot: Row[]
  /** Rows received before visitStart could be written. */
  buffer: Row[]
  fights: FightEntry[]
  members: Member[] | null
  /** The logged-in character's actorId when visitStart was written. */
  self: number | null
}
interface Fight {
  number: number
  id: string
  hash: FightHash
  enemies: Set<number>
  positions: Map<number, string>
}

/** Turns the plugin's ordered inputs into log rows, one visit at a time. */
export class Recorder {
  private sourceValue: SourceRecord | null = null
  private settingsValue: Settings | null = null
  private playerValue: { origin: 'watch' | 'get'; value: Partial<PlayerState>; t: number } | null = null
  private partyValue: GameTopics['party'] | null = null
  // Signatures of the last zone, party and player rows written in this visit; an unchanged value is not written again.
  private zoneWritten: string | null = null
  private partyWritten: string | null = null
  private playerWritten: { watch: string | null; get: string | null } = { watch: null, get: null }
  private known = new Map<number, IdentityFields>()
  private written = new Map<number, string>()
  private membership: string | null = null
  private visit: Visit | null = null
  private territoryType: number | null = null
  private fight: Fight | null = null
  private boundaries: Boundary[] = []
  private groupStart: number | null = null
  private latest = 0
  private used = new Set<string>()
  constructor(private readonly options: RecorderOptions) {}

  get visiting() {
    return this.visit !== null
  }
  /** Visit ids already present in the log, so a restart within the same second does not reuse one. */
  reserve(ids: Iterable<string>) {
    for (const id of ids) this.used.add(id)
  }
  current(): VisitEntry | null {
    const visit = this.visit
    if (!visit) return null
    return {
      id: visit.id,
      territoryType: visit.territoryType,
      zoneName: this.options.names.zone(visit.territoryType),
      enteredAt: visit.enteredAt,
      leftAt: null,
      endReason: null,
      current: true,
      scope: visit.scope,
      members: visit.members ?? this.members(),
      self: visit.released ? visit.self : (this.sourceValue?.actorId ?? null),
      integrity: 'live',
      error: null,
      fights: visit.fights.map((fight) => ({ ...fight })),
    }
  }

  source(session: SessionSnapshot) {
    const next: SourceRecord = {
      sessionId: session.sessionId,
      characterGeneration: session.characterGeneration,
      clockGeneration: session.clock.generation,
      source: session.clock.source ?? (session.state === 'idle' ? null : session.state),
      timeBase: session.clock.base ?? null,
      state: session.state,
      actorId: session.character?.actorId ?? null,
      dataLanguage: session.dataLanguage,
    }
    const key = (record: SourceRecord | null) =>
      record && `${record.sessionId}:${record.characterGeneration}:${record.clockGeneration}`
    const changed = key(this.sourceValue) !== key(next)
    this.prelude(this.latest)
    if (JSON.stringify(next) === JSON.stringify(this.sourceValue)) return
    if (changed && this.visit) this.endVisit('sourceChanged', this.latest)
    if (changed) {
      this.forget()
      this.territoryType = null
      this.known.clear()
      this.written.clear()
      this.membership = null
      this.playerValue = null
      this.partyValue = null
    }
    this.sourceValue = next
    this.record({ kind: 'source', value: next }, this.latest)
  }
  settings(value: Settings) {
    this.prelude(this.latest)
    this.settingsValue = { ...value }
    this.record({ kind: 'settings', value: this.settingsValue }, this.latest)
  }
  /**
   * @param changesCombat Whether the live statistics change their combat state on this sample. Such a sample is written even
   * when its value repeats, as is one without a usable inCombat, whose sample time moves the snapshot time on its own.
   */
  player(origin: 'watch' | 'get', value: Partial<PlayerState>, at: number, changesCombat = false) {
    const t = ms(at)
    this.prelude(t)
    this.playerValue = { origin, value, t }
    if (!this.visit) return
    const key = signature(value)
    const forced = origin === 'watch' && (changesCombat || value.inCombat?.state !== 'ok')
    if (!forced && key === this.playerWritten[origin]) return
    this.playerWritten[origin] = key
    this.record({ kind: 'player', origin, value, t }, t)
  }
  party(value: GameTopics['party'], at: number) {
    const t = ms(at)
    this.prelude(t)
    this.partyValue = value
    if (!this.visit) return
    const key = signature(value)
    if (key === this.partyWritten) return
    this.partyWritten = key
    this.record({ kind: 'party', value }, t)
  }
  zone(zone: GameTopics['zone'], at: number, carry: Carry) {
    const t = ms(at)
    this.prelude(t)
    const territoryType = value(zone.territoryType)
    if (territoryType !== null && territoryType !== this.territoryType) {
      if (this.visit) this.endVisit('zoneChanged', t)
      this.territoryType = territoryType
      this.beginVisit(territoryType, t, carry)
    }
    if (!this.visit) return
    const key = signature(zone)
    if (key === this.zoneWritten) return
    this.zoneWritten = key
    this.record({ kind: 'zone', value: zone, t }, t)
  }
  identities(
    origin: Exclude<IdentityOrigin, 'snapshot'>,
    entities: CombatantState[],
    missing: number[],
    members: ReadonlySet<number>,
    scope: Scope,
    at: number,
  ) {
    const t = ms(at)
    this.prelude(t)
    const changed: CombatantState[] = []
    for (const entity of entities) {
      if (![1, 2].includes(value(entity.objectKind) ?? value(this.known.get(entity.id)?.objectKind) ?? 0)) continue
      const signature = JSON.stringify(
        IDENTITY_FIELDS.map((name) => {
          const field = entity[name] as Field<unknown> | undefined
          return field === undefined ? null : field.state === 'ok' ? ['ok', field.value] : [field.state, field.reason]
        }),
      )
      const old = this.known.get(entity.id)
      const merged: IdentityFields = {}
      for (const name of IDENTITY_FIELDS) {
        const field = entity[name] as Field<unknown> | undefined
        const keep = STICKY.has(name) && field?.state !== 'ok' && old?.[name]?.state === 'ok'
        const chosen = keep ? old?.[name] : field
        if (chosen !== undefined) (merged as Record<string, unknown>)[name] = chosen
      }
      this.known.set(entity.id, merged)
      if (this.written.get(entity.id) === signature) continue
      this.written.set(entity.id, signature)
      changed.push(entity)
    }
    const gone = missing.filter((id) => this.known.has(id))
    for (const id of gone) {
      this.known.delete(id)
      this.written.delete(id)
    }
    const membership = JSON.stringify([[...members].sort((a, b) => a - b), scope])
    if (changed.length || gone.length || membership !== this.membership) {
      this.membership = membership
      this.record({ kind: 'identities', origin, entities: changed, missing: gone }, t)
    }
    const visit = this.visit
    if (visit && !visit.released && this.members().every((member) => member.name !== null)) this.release()
  }
  event(sample: Sample<LogEvent>) {
    const t = ms(sample.meta.observedAt)
    // An end decided after this event was applied belongs after its rows; a later input or flush writes it.
    this.prelude(t, true)
    const event = sample.value
    const kind = (id: number | null) => (id === null ? undefined : this.options.actors().get(id)?.kind)
    if (event.type === 'castStarted' || event.type === 'castCancelled') {
      if (kind(event.data.casterId) !== 'enemy') return
    } else if (event.type === 'statusChanged' || event.type === 'statusesReplaced') {
      const actor = kind(event.data.actorId)
      if (actor !== 'member' && actor !== 'pet' && actor !== 'enemy') return
    } else if (event.type === 'targetableChanged') {
      if (kind(event.data.actorId) !== 'enemy') return
    } else if (event.type === 'potencySample') {
      if (kind(event.data.casterId) !== 'member') return
    } else if (event.type === 'actionEffect' && this.fight) this.engage(event, kind)
    this.record({ kind: 'event', sample }, t)
  }
  positions(sample: Sample<GameTopics['entities']>) {
    const t = ms(sample.meta.observedAt)
    this.prelude(t)
    const fight = this.fight
    if (!fight) return
    const actors: PositionActor[] = []
    for (const entity of sample.value.entities) {
      if (![1, 2].includes(value(entity.objectKind) ?? value(this.known.get(entity.id)?.objectKind) ?? 0)) continue
      const position = value(entity.position),
        rotation = value(entity.rotation)
      if (position === null || rotation === null) continue
      const actor = {
        id: entity.id,
        x: position.x,
        z: position.z,
        rotation,
        hpCur: value(entity.hpCur),
        hpMax: value(entity.hpMax),
      }
      const signature = JSON.stringify([actor.x, actor.z, actor.rotation, actor.hpCur, actor.hpMax])
      if (fight.positions.get(actor.id) === signature) continue
      fight.positions.set(actor.id, signature)
      actors.push(actor)
    }
    if (actors.length) this.record({ kind: 'positions', t, actors }, t)
  }
  fightStarted(info: { id: string; at: number }) {
    this.boundaries.push({ kind: 'start', ...info, at: ms(info.at) })
    if (this.visit && !this.visit.released) this.release()
  }
  fightEnded(info: { id: string; reason: string; at: number; summary: Summary; afterInput?: boolean }) {
    this.boundaries.push({ kind: 'end', ...info, at: ms(info.at), afterInput: info.afterInput ?? false })
  }
  /** A fight whose end is not written yet takes the summary it has now. */
  fightRevised(info: { id: string; summary: Summary }) {
    for (const boundary of this.boundaries)
      if (boundary.kind === 'end' && boundary.id === info.id) {
        boundary.summary = info.summary
        this.listEnd(boundary)
      }
  }
  /** Writes fight boundaries decided by a timer or command, which have no input of their own. */
  flushBoundaries() {
    this.prelude(this.latest)
  }
  tick(now: number | null) {
    if (now !== null) this.prelude(ms(now))
  }
  stop(at: number) {
    const t = ms(at)
    this.prelude(t)
    if (this.visit) this.endVisit('stopped', t)
  }

  private prelude(t: number, holdTrailing = false) {
    if (Number.isFinite(t)) this.latest = Math.max(this.latest, t)
    while (this.boundaries.length) {
      const boundary = this.boundaries[0]
      if (holdTrailing && boundary.kind === 'end' && boundary.afterInput) break
      // The game may report the deaths of a fight that left combat seconds late; its end waits for them unless the
      // next fight starts first.
      if (
        boundary.kind === 'end' &&
        boundary.reason === 'outOfCombat' &&
        this.boundaries.length === 1 &&
        this.latest <= boundary.at + LATE_DEATH_MS
      ) {
        this.listEnd(boundary)
        break
      }
      this.boundaries.shift()
      if (boundary.kind === 'start') this.startFight(boundary)
      else this.endFight(boundary)
    }
    const visit = this.visit
    if (visit && !visit.released && t >= visit.enteredAt + RELEASE_AFTER_MS) this.release()
  }
  private engage(event: Extract<LogEvent, { type: 'actionEffect' }>, kind: (id: number | null) => string | undefined) {
    const fight = this.fight!
    const source = event.data.sourceActorId
    const before = fight.enemies.size
    for (const target of event.data.targets) {
      const pair = [source, target.targetId]
      for (const [a, b] of [pair, [...pair].reverse()])
        if (a !== null && b !== null && kind(a) === 'member' && kind(b) === 'enemy') fight.enemies.add(b)
    }
    if (fight.enemies.size !== before) this.options.positions(this.sampled(fight))
  }
  private sampled(fight: Fight) {
    return [...new Set([...this.members().map((member) => member.actorId), ...fight.enemies])]
  }
  private members(): Member[] {
    const members: Member[] = []
    for (const actor of this.options.actors().values())
      if (actor.kind === 'member')
        members.push({
          actorId: actor.id,
          name: actor.name,
          worldId: actor.worldId,
          job: actor.job,
          jobName: actor.job === null ? null : this.options.names.job(actor.job),
        })
    return members
  }
  private forget() {
    this.zoneWritten = null
    this.partyWritten = null
    this.playerWritten = { watch: null, get: null }
  }
  private beginVisit(territoryType: number, t: number, carry: Carry) {
    // Each visit replays on its own, and its snapshot player row does not sync combat, so its first inputs are always written.
    this.forget()
    let id = visitId(t, territoryType)
    for (let n = 2; this.used.has(id); n++) id = `${visitId(t, territoryType)}-${n}`
    this.used.add(id)
    const scope = this.settingsValue?.scope ?? 'party'
    const records: DataRecord[] = []
    if (this.sourceValue) records.push({ kind: 'source', value: this.sourceValue })
    if (this.settingsValue) records.push({ kind: 'settings', value: this.settingsValue })
    records.push({ kind: 'carry', value: carry })
    if (this.playerValue) records.push({ kind: 'player', ...this.playerValue })
    if (this.partyValue) records.push({ kind: 'party', value: this.partyValue })
    const generations = new Map(carry.generations)
    records.push({
      kind: 'identities',
      origin: 'snapshot',
      entities: [...this.known].map(([actor, fields]) => ({
        id: actor,
        ...fields,
        generation: generations.get(actor) ?? 0,
      })),
      missing: [],
    })
    this.visit = {
      id,
      territoryType,
      enteredAt: t,
      scope,
      released: false,
      snapshot: [],
      buffer: [],
      fights: [],
      members: null,
      self: null,
    }
    this.visit.snapshot = records.flatMap((record) => this.rows(record, t))
  }
  /** Writes visitStart, the entry snapshot and everything held back since entering. */
  private release() {
    const visit = this.visit!
    visit.released = true
    visit.members = this.members()
    // Taken on release rather than on entry: the character's identity may arrive in between.
    visit.self = this.sourceValue?.actorId ?? null
    this.options.sink.beginVisit(visit.id, visit.enteredAt)
    this.append({
      ...noteRow(
        visitStartNote({
          visit: visit.id,
          territoryType: visit.territoryType,
          zone: this.options.names.zone(visit.territoryType),
          enteredAt: visit.enteredAt,
          scope: visit.scope,
          members: visit.members,
          self: visit.self,
        }),
      ),
      visit: visit.id,
      t: visit.enteredAt,
    })
    for (const row of [...visit.snapshot, ...visit.buffer]) this.append(row)
    visit.snapshot = []
    visit.buffer = []
  }
  private endVisit(reason: VisitEndReason, t: number) {
    const visit = this.visit!
    if (!visit.released) this.release()
    for (const boundary of this.boundaries.splice(0))
      if (boundary.kind === 'start') this.startFight(boundary)
      else this.endFight(boundary)
    if (this.fight) {
      this.options.positions(null)
      this.fight = null
    }
    this.append({
      ...noteRow(visitEndNote({ visit: visit.id, leftAt: t, reason, fights: visit.fights.length })),
      visit: visit.id,
      t,
    })
    this.cut()
    this.options.sink.endVisit()
    this.visit = null
  }
  private startFight(boundary: Extract<Boundary, { kind: 'start' }>) {
    const visit = this.visit
    if (!visit) return
    if (!visit.released) this.release()
    if (this.fight) this.options.positions(null)
    this.cut()
    const fight: Fight = {
      number: visit.fights.length + 1,
      id: boundary.id,
      hash: new FightHash(),
      enemies: new Set(),
      positions: new Map(),
    }
    this.fight = fight
    const scope = this.settingsValue?.scope ?? 'party'
    visit.fights.push({
      number: fight.number,
      id: fight.id,
      startAt: boundary.at,
      endAt: null,
      reason: null,
      scope,
      durationMs: null,
      deaths: null,
      result: null,
      mainEnemy: null,
      truncated: false,
      hashed: false,
    })
    this.options.sink.fightStarted()
    this.append({
      ...noteRow(
        fightStartNote({
          visit: visit.id,
          fight: fight.number,
          id: fight.id,
          zone: this.options.names.zone(visit.territoryType),
          enteredAt: visit.enteredAt,
          startAt: boundary.at,
          scope,
        }),
      ),
      visit: visit.id,
      t: boundary.at,
      fight: fight.number,
    })
    this.options.positions(this.sampled(fight))
  }
  private endFight(boundary: Extract<Boundary, { kind: 'end' }>) {
    const visit = this.visit,
      fight = this.fight
    // A fight that started before this visit's log began has no fightStart, so it gets no fightEnd either.
    if (!visit || !fight || fight.id !== boundary.id) return
    this.cut()
    const truncated = this.options.sink.fightTruncated()
    const brief = this.brief(boundary)
    const note = fightEndNote({ ...brief, visit: visit.id, fight: fight.number, truncated })
    const row: Row = { kind: 'fightEnd', visit: visit.id, t: boundary.at, fight: fight.number }
    const hash = truncated ? null : fight.hash.finish(row, note)
    this.fight = null
    this.options.sink.append({ ...row, ...noteRow({ ...note, hash }) })
    this.cut()
    this.options.sink.fightEnded()
    this.options.positions(null)
    const entry = visit.fights.find((item) => item.number === fight.number)!
    Object.assign(entry, { ...brief, truncated, hashed: hash !== null })
  }
  private brief(boundary: Extract<Boundary, { kind: 'end' }>) {
    const { summary } = boundary
    return {
      endAt: boundary.at,
      durationMs: summary.durationMs ?? null,
      reason: boundary.reason,
      ...this.options.brief(summary),
      deaths: summary.rows.reduce((sum, row) => sum + row.totals.deaths, 0),
    }
  }
  /** Lists a fight as ended while its end waits to be written, so the page shows it and can review it. */
  private listEnd(boundary: Extract<Boundary, { kind: 'end' }>) {
    const fight = this.fight
    if (fight?.id !== boundary.id) return
    Object.assign(this.visit!.fights.find((item) => item.number === fight.number)!, this.brief(boundary))
  }
  private rows(record: DataRecord, t: number) {
    const visit = this.visit!
    const fight = this.fight
    return rowsFor(record).map(
      (row): Row => ({ ...row, visit: visit.id, t, ...(fight ? { fight: fight.number } : {}) }),
    )
  }
  private record(record: DataRecord, t: number) {
    const visit = this.visit
    if (!visit) return
    const rows = this.rows(record, t)
    if (!visit.released) visit.buffer.push(...rows)
    else for (const row of rows) this.append(row)
  }
  private append(row: Row) {
    const t = row.t as number
    if (this.groupStart !== null && Math.abs(t - this.groupStart) > GROUP_SPAN_MS) this.cut()
    if (this.groupStart === null) this.groupStart = t
    this.options.sink.append(row)
    this.fight?.hash.update(row)
  }
  private cut() {
    this.groupStart = null
    this.options.sink.cut()
  }
}
