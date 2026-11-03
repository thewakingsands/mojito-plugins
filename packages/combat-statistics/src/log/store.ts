import type { Limits, LogService, StorageService } from '@ffcafe/mojito-plugin-sdk'
import { HashCheck } from './hash.js'
import {
  buildFile,
  decodeColumns,
  type EncodedRowGroup,
  encodeRowGroup,
  FORMAT,
  FORMAT_KEY,
  ParquetFormatError,
  type ParsedFile,
  parseFile,
} from './parquet.js'
import type { RecorderSink } from './recorder.js'
import { Assembler, COLUMN_NAMES, COLUMNS, localDate, type Note, parseNote, type Row } from './schema.js'
import { LogIntegrityError, type LogRecord, type VisitEntry } from './types.js'

const DIRECTORY = 'log'
const ROW_GROUPS_KEY = 'mojito.rowGroups'
const FILE_MARGIN = 64 * 1024
const BUDGET_MARGIN = 1024 * 1024
/** The host fails an activation after 10 seconds, and reading the log is only part of it. */
const OPEN_BUDGET_MS = 5000
/** Below `storage.listItems`, past which the host refuses to list the directory and `open` would find no log at all. */
const FILE_COUNT_MARGIN = 16
/** How many visits with a fight the feature page lists, and so how many `open` looks for. */
export const LISTED_VISITS = 100
export const SPACE_FULL = '日志空间已满，这次进本之后的记录没有保存'
export const INTEGRITY_FAILED = '日志校验失败'

/** `log/2026-10-26.parquet` is part 1 of that day, `log/2026-10-26-2.parquet` part 2. */
function fileName(name: string): { date: string; part: number } | null {
  const match = /^log\/(\d{4}-\d{2}-\d{2})(?:-(\d+))?\.parquet$/.exec(name)
  return match ? { date: match[1], part: match[2] ? Number(match[2]) : 1 } : null
}
function compareNames(a: string, b: string) {
  const x = fileName(a),
    y = fileName(b)
  if (!x || !y) return a < b ? -1 : a > b ? 1 : 0
  return x.date < y.date ? -1 : x.date > y.date ? 1 : x.part - y.part
}

interface Loaded {
  name: string
  date: string
  groups: EncodedRowGroup[]
  /** Visit id of each row group. */
  visits: string[]
  /** Row groups already on disk in their current position. */
  saved: number
  dirty: boolean
}
interface Known {
  size: number
  visits: Set<string>
}
type NoteCell = [visit: string, kind: string, t: number, cell: string]

/** Builds the visit list from notes, both when opening files and while writing. */
class VisitIndex {
  readonly entries = new Map<string, VisitEntry>()
  note(visit: string, kind: string, t: number, cell: string) {
    let note: Note
    try {
      note = parseNote(kind, cell)
    } catch {
      const entry = this.entries.get(visit)
      if (entry) this.fail(entry)
      return
    }
    if (note.note === 'visitStart') {
      this.entries.set(visit, {
        id: visit,
        territoryType: note.territoryType,
        zoneName: note.zone,
        enteredAt: t,
        leftAt: null,
        endReason: 'interrupted',
        current: false,
        scope: note.scope,
        members: note.members,
        integrity: 'unchecked',
        error: null,
        fights: [],
      })
      return
    }
    const entry = this.entries.get(visit)
    if (!entry || entry.integrity === 'failed') return
    if (note.note === 'visitEnd') {
      entry.leftAt = t
      entry.endReason = note.reason
    } else if (note.note === 'fightStart')
      entry.fights.push({
        number: note.fight,
        id: note.id,
        startAt: t,
        endAt: null,
        reason: null,
        scope: note.scope,
        durationMs: null,
        deaths: null,
        result: null,
        mainEnemy: null,
        truncated: false,
        hashed: false,
      })
    else {
      const fight = entry.fights.find((item) => item.number === note.fight)
      if (!fight) return
      Object.assign(fight, {
        endAt: t,
        reason: note.reason,
        durationMs: note.durationMs,
        deaths: note.deaths,
        result: note.result,
        mainEnemy: note.mainEnemy,
        truncated: note.truncated,
        hashed: typeof note.hash === 'string',
      })
    }
  }
  fail(entry: VisitEntry) {
    entry.integrity = 'failed'
    entry.error = INTEGRITY_FAILED
    entry.fights = []
  }
}

/** Owns the log files: one per day, new parts near the size limit, eviction by capacity. */
export class LogStore implements RecorderSink {
  readonly index = new VisitIndex()
  error: string | null = null
  private known = new Map<string, Known>()
  private skipped = new Map<string, number>()
  /** Older files `open` left alone. Their size is unknown, so only `quota_exceeded` from the host accounts for them. */
  private unread = new Set<string>()
  private resume: { name: string; parsed: ParsedFile; size: number } | null = null
  private file: Loaded | null = null
  private closed: Loaded[] = []
  private rows: Row[] = []
  private visit: string | null = null
  private visitFiles = new Set<string>()
  private fightStart: number | null = null
  private truncated = false
  private full = false
  private readonly fileLimit: number
  private readonly budget: number
  private readonly fileCount: number
  constructor(
    private readonly storage: StorageService,
    limits: Limits,
    private readonly createdBy: string,
    private readonly log?: Pick<LogService, 'warn'>,
    /** Storage the plugin keeps for other files */
    reservedBytes = 0,
  ) {
    this.fileLimit = (limits.values['storage.fileBytes'] ?? 3 * 1024 * 1024) - FILE_MARGIN
    this.budget = (limits.values['storage.pluginBytes'] ?? 32 * 1024 * 1024) - BUDGET_MARGIN - reservedBytes
    this.fileCount = (limits.values['storage.listItems'] ?? 1000) - FILE_COUNT_MARGIN
  }

  /**
   * Reads the files from newest to oldest until `visits` visits with a fight are found or `budgetMs` has passed. The
   * files of today and the last file are always read, since writing continues in them.
   */
  async open(visits = LISTED_VISITS, budgetMs = OPEN_BUDGET_MS) {
    // Listing is part of the budget: the host looks at every file of the directory, which takes seconds near the limit.
    const started = Date.now()
    let names: string[]
    try {
      names = await this.storage.list(DIRECTORY)
    } catch (error) {
      if ((error as { code?: string }).code === 'not_found') return
      throw error
    }
    names = names.filter((name) => name.startsWith(`${DIRECTORY}/`)).sort(compareNames)
    const today = localDate(Date.now())
    const last = names.filter((name) => fileName(name)).at(-1)
    const entered = new Set<string>()
    const fought = new Set<string>()
    let listed = 0
    const decoded: NoteCell[][] = []
    for (const name of names.reverse()) {
      const parsedName = fileName(name)
      // An unrecognized file is read as well: it is never deleted, so its size has to count against the budget.
      const required = !parsedName || parsedName.date === today || name === last
      if (!required && (listed >= visits || Date.now() - started >= budgetMs)) {
        this.unread.add(name)
        continue
      }
      let bytes: Uint8Array
      try {
        bytes = await this.storage.read(name)
      } catch (error) {
        this.log?.warn('日志文件无法读取', { file: name, error: String(error) })
        continue
      }
      try {
        if (!parsedName) throw new ParquetFormatError('文件名不是日志文件')
        const parsed = parseFile(bytes, COLUMNS)
        const groupVisits = this.groupVisits(parsed)
        const notes: NoteCell[] = []
        for (let group = 0; group < parsed.groups.length; group++) {
          const [cells, kinds, times] = await decodeColumns(parsed, group, ['note', 'kind', 't'])
          cells.forEach((cell, row) => {
            if (cell === null) return
            const visit = groupVisits[group]
            const kind = String(kinds[row])
            notes.push([visit, kind, times[row] as number, String(cell)])
            // A visit can only be listed once its start is read, and that may be in an older file than its fights.
            const seen = kind === 'visitStart' ? entered : kind === 'fightStart' ? fought : null
            if (!seen || seen.has(visit)) return
            seen.add(visit)
            if (entered.has(visit) && fought.has(visit)) listed++
          })
        }
        decoded.push(notes)
        this.known.set(name, { size: bytes.length, visits: new Set(groupVisits) })
        this.resume ??= { name, parsed, size: bytes.length }
      } catch (error) {
        this.skipped.set(name, bytes.length)
        this.log?.warn('跳过无法识别的日志文件', { file: name, error: String(error) })
      }
    }
    for (const notes of decoded.reverse()) for (const note of notes) this.index.note(...note)
  }
  status() {
    return { error: this.error }
  }

  beginVisit(visit: string, enteredAt: number) {
    const date = localDate(enteredAt)
    const resume = this.resume
    this.resume = null
    if (!this.file && resume && fileName(resume.name)?.date === date) {
      const visits = this.groupVisits(resume.parsed)
      this.file = {
        name: resume.name,
        date,
        groups: resume.parsed.groups,
        visits,
        saved: visits.length,
        dirty: false,
      }
    }
    if (this.file?.date !== date) {
      if (this.file?.dirty) this.closed.push(this.file)
      this.file = this.create(date)
    }
    this.visit = visit
    this.visitFiles = new Set([this.file.name])
    this.full = false
  }
  append(row: Row) {
    if (typeof row.note === 'string' && row.visit)
      this.index.note(String(row.visit), String(row.kind), row.t as number, row.note)
    if (!this.file || this.full) return
    // A truncated fight keeps its end note so the visit still shows how the fight ended.
    if (this.truncated && row.kind !== 'fightEnd') return
    this.rows.push(row)
  }
  cut() {
    const file = this.file
    if (!file || !this.rows.length || !this.visit) return
    file.groups.push(this.encode(this.rows))
    file.visits.push(this.visit)
    file.dirty = true
    this.rows = []
  }
  fightStarted() {
    this.fightStart = this.file?.groups.length ?? null
    this.truncated = false
  }
  fightTruncated() {
    return this.truncated
  }
  fightEnded() {
    this.fightStart = null
    this.truncated = false
  }
  endVisit() {
    this.cut()
    this.visit = null
    this.visitFiles = new Set()
  }

  /** Writes every file with new rows; failures keep the rows for the next call. */
  async flush() {
    while (this.closed.length) {
      const file = this.closed[0]
      if (!(await this.save(file, file.groups))) return
      this.closed.shift()
    }
    const file = this.file
    if (!file || (!file.dirty && !this.rows.length)) return
    let groups = [...file.groups, ...this.partial()]
    if (this.size(file, groups) > this.fileLimit) {
      const moved = this.fightStart ?? file.saved
      // Without an open fight only the unsaved groups move; an open fight moves whole so it stays in one file.
      if (moved > 0) {
        const next = this.create(file.date)
        next.groups = file.groups.splice(moved)
        next.visits = file.visits.splice(moved)
        next.dirty = true
        file.saved = Math.min(file.saved, moved)
        file.dirty = true
        if (this.fightStart !== null) this.fightStart = 0
        if (!(await this.save(file, file.groups))) {
          // Keep the old file pending; the moved groups are written once it succeeds.
          this.closed.push(file)
          this.file = next
          if (this.visit) this.visitFiles.add(next.name)
          return
        }
        this.file = next
        if (this.visit) this.visitFiles.add(next.name)
      }
      const target = this.file!
      groups = [...target.groups, ...this.partial()]
      if (this.fightStart !== null && this.size(target, groups) > this.fileLimit) {
        this.truncated = true
        // The fight's first group must survive, since it holds the fightStart note.
        if (this.rows[0]?.kind === 'fightStart') this.rows = [this.rows[0]]
        else {
          this.rows = []
          while (target.groups.length > this.fightStart + 1 && this.size(target, target.groups) > this.fileLimit) {
            target.groups.pop()
            target.visits.pop()
          }
        }
        groups = [...target.groups, ...this.partial()]
      }
    }
    const target = this.file!
    if (await this.save(target, groups)) target.dirty = false
  }

  /** Reads a visit's rows in order; `current` adds the rows not yet written, `verify` checks the fight hashes. */
  async *read(visit: string, current: boolean, verify: boolean): AsyncGenerator<LogRecord> {
    const assembler = new Assembler()
    const check = new HashCheck()
    const loaded = new Map([...this.closed, ...(this.file ? [this.file] : [])].map((file) => [file.name, file]))
    const names = [...this.known].filter(([, known]) => known.visits.has(visit)).map(([name]) => name)
    for (const file of loaded.values())
      if (file.visits.includes(visit) && !names.includes(file.name)) names.push(file.name)
    try {
      for (const name of names.sort(compareNames)) {
        const memory = loaded.get(name)
        const parsed = memory
          ? parseFile(buildFile(COLUMNS, memory.groups, this.kv(memory.visits), this.createdBy))
          : parseFile(await this.storage.read(name), COLUMNS)
        const visits = this.groupVisits(parsed)
        for (let group = 0; group < visits.length; group++) {
          if (visits[group] !== visit) continue
          const columns = await decodeColumns(parsed, group, COLUMN_NAMES)
          for (let index = 0; index < (columns[0]?.length ?? 0); index++) {
            const row: Row = {}
            COLUMN_NAMES.forEach((column, c) => {
              const cell = columns[c][index]
              if (cell !== null) row[column] = cell
            })
            if (verify) check.push(row)
            yield* assembler.push(row)
          }
        }
      }
      if (current && this.visit === visit) for (const row of [...this.rows]) yield* assembler.push(row)
      yield* assembler.flush()
    } catch (error) {
      if (error instanceof ParquetFormatError) throw new LogIntegrityError(`${INTEGRITY_FAILED}：${error.message}`)
      throw error
    }
  }

  /** Deletes every visit except `keep`, which may span several files. */
  async clear(keep: string | null) {
    const loaded = new Map([...this.closed, ...(this.file ? [this.file] : [])].map((file) => [file.name, file]))
    const names = new Set([...this.known.keys(), ...loaded.keys()])
    for (const name of [...names].sort(compareNames)) {
      const memory = loaded.get(name)
      const visits = memory ? new Set(memory.visits) : this.known.get(name)!.visits
      if (memory === this.file && this.visit) visits.add(this.visit)
      if (keep === null || !visits.has(keep)) {
        if (memory) {
          memory.groups = []
          memory.visits = []
          memory.saved = 0
          memory.dirty = false
          this.closed = this.closed.filter((file) => file !== memory)
        }
        if (this.known.has(name)) await this.remove(name)
        continue
      }
      let target = memory
      if (!target) {
        const parsed = parseFile(await this.storage.read(name), COLUMNS)
        target = {
          name,
          date: fileName(name)!.date,
          groups: parsed.groups,
          visits: this.groupVisits(parsed),
          saved: 0,
          dirty: true,
        }
      }
      const kept = target.visits.map((visit, index) => (visit === keep ? index : -1)).filter((index) => index >= 0)
      if (this.fightStart !== null && target === this.file)
        this.fightStart = kept.filter((index) => index < this.fightStart!).length
      target.groups = kept.map((index) => target.groups[index])
      target.visits = kept.map((index) => target.visits[index])
      target.saved = 0
      target.dirty = true
      const groups = target === this.file ? [...target.groups, ...this.partial()] : target.groups
      if (groups.length) await this.save(target, groups)
      else if (this.known.has(name)) await this.remove(name)
    }
    for (const name of [...this.unread]) await this.remove(name)
    for (const id of [...this.index.entries.keys()]) if (id !== keep) this.index.entries.delete(id)
  }

  private create(date: string): Loaded {
    const taken = (name: string) =>
      this.known.has(name) ||
      this.skipped.has(name) ||
      this.unread.has(name) ||
      this.closed.some((file) => file.name === name) ||
      this.file?.name === name
    let name = `${DIRECTORY}/${date}.parquet`
    for (let part = 2; taken(name); part++) name = `${DIRECTORY}/${date}-${part}.parquet`
    return { name, date, groups: [], visits: [], saved: 0, dirty: false }
  }
  /** The row group still being filled, encoded for this write only. */
  private partial() {
    return this.rows.length && this.visit ? [this.encode(this.rows)] : []
  }
  private encode(rows: Row[]) {
    return encodeRowGroup(
      COLUMNS,
      COLUMN_NAMES.map((name) => rows.map((row) => row[name] ?? null)),
    )
  }
  private kv(visits: string[]) {
    return { [FORMAT_KEY]: FORMAT, [ROW_GROUPS_KEY]: JSON.stringify(visits) }
  }
  private groupVisits(parsed: ParsedFile): string[] {
    let visits: unknown
    try {
      visits = JSON.parse(parsed.kv[ROW_GROUPS_KEY] ?? 'null')
    } catch {
      /* Reported below. */
    }
    if (
      !Array.isArray(visits) ||
      visits.length !== parsed.groups.length ||
      visits.some((visit) => typeof visit !== 'string')
    )
      throw new ParquetFormatError('行组的进本列表无效')
    return visits
  }
  private size(file: Loaded, groups: EncodedRowGroup[]) {
    return this.bytes(file, groups).length
  }
  private bytes(file: Loaded, groups: EncodedRowGroup[]) {
    const visits = [...file.visits]
    while (visits.length < groups.length) visits.push(this.visit ?? '')
    return buildFile(COLUMNS, groups, this.kv(visits), this.createdBy)
  }
  private used(except: string) {
    let total = 0
    for (const [name, known] of this.known) if (name !== except) total += known.size
    for (const size of this.skipped.values()) total += size
    return total
  }
  /** The oldest file that holds neither the current visit nor unsaved rows. */
  private evictable(writing: string) {
    const busy = new Set([writing, ...this.visitFiles, ...this.closed.map((file) => file.name)])
    if (this.file) busy.add(this.file.name)
    return [...this.known.keys(), ...this.unread].filter((name) => !busy.has(name)).sort(compareNames)[0] ?? null
  }
  private async remove(name: string) {
    const known = this.known.get(name)
    await this.storage.delete(name)
    this.known.delete(name)
    this.unread.delete(name)
    for (const visit of known?.visits ?? []) {
      const elsewhere = [...this.known.values()].some((other) => other.visits.has(visit))
      if (!elsewhere && visit !== this.visit) this.index.entries.delete(visit)
    }
  }
  private async save(file: Loaded, groups: EncodedRowGroup[]): Promise<boolean> {
    if (this.full && file === this.file) return false
    if (!groups.length) {
      if (this.known.has(file.name)) await this.remove(file.name)
      return true
    }
    const bytes = this.bytes(file, groups)
    if (!this.known.has(file.name))
      while (this.known.size + this.unread.size + this.skipped.size >= this.fileCount) {
        const victim = this.evictable(file.name)
        if (!victim) break
        await this.remove(victim)
      }
    while (this.used(file.name) + bytes.length > this.budget) {
      const victim = this.evictable(file.name)
      if (!victim) {
        this.fill(file)
        return false
      }
      await this.remove(victim)
    }
    try {
      await this.writeEvicting(file.name, bytes)
    } catch (error) {
      this.error = `日志写入失败：${(error as { message?: string }).message ?? String(error)}`
      return false
    }
    const visits = [...file.visits]
    while (visits.length < groups.length) visits.push(this.visit ?? '')
    this.known.set(file.name, { size: bytes.length, visits: new Set(visits) })
    file.saved = file.groups.length
    if (!this.full) this.error = null
    return true
  }
  /** A file over the single-file limit also reports `quota_exceeded`, but deleting others would not help it. */
  private async writeEvicting(name: string, bytes: Uint8Array) {
    for (;;) {
      try {
        await this.storage.write(name, bytes)
        return
      } catch (error) {
        const victim = bytes.length <= this.fileLimit + FILE_MARGIN ? this.evictable(name) : null
        if ((error as { code?: string }).code !== 'quota_exceeded' || !victim) throw error
        await this.remove(victim)
      }
    }
  }
  /** Out of space: drop this visit's unsaved rows and stop writing until the next visit. */
  private fill(file: Loaded) {
    this.full = true
    this.error = SPACE_FULL
    this.rows = []
    file.groups.splice(file.saved)
    file.visits.splice(file.saved)
    file.dirty = false
  }
}
