import type { Limits, LogService, StorageService } from '@ffcafe/mojito-plugin-sdk'
import { GAME_CACHE_BYTES } from '../game-cache.js'
import { Recorder, type RecorderOptions } from './recorder.js'
import { LogStore } from './store.js'
import { LogIntegrityError, type LogRecord, type VisitEntry } from './types.js'

export { LISTED_VISITS } from './store.js'
export type { LogRecord, VisitEntry } from './types.js'
export { LogIntegrityError } from './types.js'

/** The combat log: Recorder writes the plugin's inputs, LogStore keeps the files, this class answers readers. */
export class CombatLog {
  readonly recorder: Recorder
  private readonly store: LogStore
  constructor(
    storage: StorageService,
    limits: Limits,
    options: Omit<RecorderOptions, 'sink'> & { createdBy: string; log?: Pick<LogService, 'warn'> },
  ) {
    const { createdBy, log, ...recorder } = options
    this.store = new LogStore(storage, limits, createdBy, log, GAME_CACHE_BYTES)
    this.recorder = new Recorder({ ...recorder, sink: this.store })
  }
  async open() {
    await this.store.open()
    this.recorder.reserve(this.store.index.entries.keys())
  }
  /** Every visit in the log, newest first, including the one in progress. */
  list(): VisitEntry[] {
    const current = this.recorder.current()
    const entries = [...this.store.index.entries.values()]
      .filter((entry) => entry.id !== current?.id)
      .map((entry) => ({ ...entry, fights: entry.fights.map((fight) => ({ ...fight })) }))
    if (current) entries.push(current)
    return entries.sort((a, b) => b.enteredAt - a.enteredAt)
  }
  /**
   * Reads one visit's records in written order. A finished visit is hash-checked the first time it is read; once it
   * passed, this activation trusts the files it already checked.
   */
  async *read(visitId: string): AsyncGenerator<LogRecord> {
    const current = this.recorder.current()?.id === visitId
    const entry = this.store.index.entries.get(visitId)
    if (!current && !entry) throw new Error('未找到这次进本的日志')
    if (!current && entry?.integrity === 'failed') throw new LogIntegrityError(entry.error ?? '日志校验失败')
    try {
      yield* this.store.read(visitId, current, !current && entry?.integrity !== 'verified')
    } catch (error) {
      if (!current && entry && error instanceof LogIntegrityError) this.store.index.fail(entry)
      throw error
    }
    if (!current && entry) entry.integrity = 'verified'
  }
  /** Deletes every visit except the one in progress. */
  clear() {
    return this.store.clear(this.recorder.current()?.id ?? null)
  }
  flush() {
    return this.store.flush()
  }
  status() {
    return this.store.status()
  }
}
