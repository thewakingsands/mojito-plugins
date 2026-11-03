import type { DataService, LogService, StorageService } from '@ffcafe/mojito-plugin-sdk'

/** The storage the cache may take; the combat log keeps out of it */
export const GAME_CACHE_BYTES = 4 * 1024 * 1024
/** Names kept of each kind; the oldest go first */
const NAME_LIMIT = 8000
const ICON_BYTES = 3 * 1024 * 1024
/** Few enough icon files that the host can still list the directory */
const ICON_LIMIT = 800
/** How long after the last change the index and the names are written */
const FLUSH_MS = 2000
/** A name, icon row or column that could not be read is asked for again after this long */
const RETRY_MS = 60_000
const DIRECTORY = 'game-data'
const INDEX = `${DIRECTORY}/index.json`
const namesFile = (language: string) => `${DIRECTORY}/names-${language}.json`
const iconFile = (id: number) => `${DIRECTORY}/icons/${id}.png`
const ICON_COLUMN = 2
/** The column each value is read from, Action's CooldownGroup and Status's StatusCategory */
const COLUMNS = {
  cooldownGroup: { sheet: 'Action', index: 41 },
  statusCategory: { sheet: 'Status', index: 6 },
} as const

/** The reads of the game data the cache makes */
export type GameData = Pick<DataService, 'version' | 'name' | 'rows' | 'icon'>
export type NameKind = 'action' | 'status' | 'territoryType'
export type ColumnKind = keyof typeof COLUMNS
export type CachedIcon = { mime: string; data: Uint8Array }
interface Index {
  version: string | null
  language: string | null
  iconIds: [string, number | null][]
  cooldownGroup: [number, number][]
  statusCategory: [number, number][]
  icons: [number, number][]
}
type Names = Record<NameKind, [number, string][]>

/** The host has no game data open, as opposed to a row or icon the open data lacks. */
function unavailable(error: unknown) {
  return (error as { code?: string } | null)?.code === 'unavailable'
}
const notFound = (error: unknown) => (error as { code?: string } | null)?.code === 'not_found'
const pairs = (value: unknown): [unknown, unknown][] =>
  Array.isArray(value)
    ? value.filter((item): item is [unknown, unknown] => Array.isArray(item) && item.length === 2)
    : []
const isId = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0
const numbers = (value: unknown) =>
  new Map(pairs(value).filter((item): item is [number, number] => isId(item[0]) && typeof item[1] === 'number'))

/**
 * Names, icons and columns read from the game data, kept in the plugin storage so a review shows them without asking
 * the game data again, even while it is closed. Everything is dropped when the version of the game data changes.
 */
export class GameDataCache {
  /** The version the stored files belong to */
  private version: string | null = null
  /** The language of the names in memory */
  private language: string | null = null
  /** The language of the open game data; null while none is open, when only what is cached can be given */
  private open: string | null = null
  /** Whether what is read may be written, once the version of the open game data is known */
  private writable = false
  private names: Record<NameKind, Map<number, string>> = {
    action: new Map(),
    status: new Map(),
    territoryType: new Map(),
  }
  private iconIds = new Map<string, number | null>()
  private columnValues: Record<ColumnKind, Map<number, number>> = {
    cooldownGroup: new Map(),
    statusCategory: new Map(),
  }
  /** The stored icon files and their sizes, oldest first */
  private stored = new Map<number, number>()
  /** Icons read in this activation; null for one the game data lacks */
  private icons = new Map<number, CachedIcon | null>()
  /** When something could not be read, by `${kind}:${id}`; never stored */
  private missing = new Map<string, number>()
  private indexDirty = false
  private namesDirty = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private warned = false
  private checking: Promise<void> = Promise.resolve()
  /** Storage operations run one at a time, so a clear never races a write */
  private writing: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly storage: StorageService,
    private readonly data: GameData,
    private readonly log: Pick<LogService, 'warn'>,
    private readonly rowIds: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Reads what an earlier activation stored */
  async load() {
    const index = await this.readJson(INDEX)
    if (!index || typeof index !== 'object') return
    const value = index as Partial<Record<keyof Index, unknown>>
    this.version = typeof value.version === 'string' ? value.version : null
    this.language = typeof value.language === 'string' ? value.language : null
    for (const [key, id] of pairs(value.iconIds))
      if (typeof key === 'string' && (id === null || isId(id))) this.iconIds.set(key, id)
    for (const kind of Object.keys(COLUMNS) as ColumnKind[]) this.columnValues[kind] = numbers(value[kind])
    for (const [id, size] of numbers(value.icons)) this.stored.set(id, size)
    if (this.language) await this.loadNames(this.language)
    // Icon files written after the index was last saved are not counted, so they go.
    await this.exclusive(async () => {
      for (const name of await this.storage.list(`${DIRECTORY}/icons`).catch(() => [])) {
        const id = Number(/(\d+)\.png$/.exec(name)?.[1])
        if (!this.stored.has(id)) await this.storage.delete(name).catch(() => {})
      }
    })
  }

  /**
   * Follows the game data the host has open, null when none is: drops everything when its version is not the one
   * stored, and switches the names to its language. A version that cannot be read keeps what is cached; a host
   * older than plugin API 1.4.0 has no version at all, so what is read there stays in memory.
   */
  validate(language: string | null): Promise<void> {
    const next = this.checking.then(() => this.check(language))
    this.checking = next.catch(() => {})
    return next
  }
  private async check(language: string | null) {
    this.open = language
    if (language === null) return
    let version: string | null | undefined
    try {
      version = await this.data.version()
    } catch {
      version = undefined
    }
    if (version !== undefined) {
      if (version !== this.version) {
        await this.clear()
        this.version = version
        this.indexDirty = true
      }
      this.writable = version !== null
    }
    if (language !== this.language) {
      // Only the names of one language are kept, so they stay within the storage of the cache.
      const previous = this.language
      if (previous) await this.exclusive(() => this.storage.delete(namesFile(previous)).catch(() => {}))
      this.names = { action: new Map(), status: new Map(), territoryType: new Map() }
      this.namesDirty = false
      this.language = language
      this.indexDirty = true
      await this.loadNames(language)
    }
    this.schedule()
  }

  /** A name the cache has, without reading the game data */
  cached(kind: NameKind, id: number): string | null {
    return this.names[kind].get(id) ?? null
  }
  /** The names of a kind the cache has, as they are now */
  all(kind: NameKind): ReadonlyMap<number, string> {
    return this.names[kind]
  }

  /** A name, read from the game data when the cache lacks it; incomplete when no game data could be read */
  async name(kind: NameKind, id: number): Promise<{ name: string | null; complete: boolean }> {
    await this.checking
    const cached = this.names[kind].get(id)
    if (cached !== undefined) return { name: cached, complete: true }
    const key = `${kind}:${id}`
    if (this.recentlyMissing(key)) return { name: null, complete: true }
    const language = this.open
    if (language === null) return { name: null, complete: false }
    try {
      const name = await this.data.name(kind, id, language)
      if (!name) {
        this.missing.set(key, this.now())
        return { name: null, complete: true }
      }
      // A name read in another language than the one now cached is not kept.
      if (language === this.language) {
        const names = this.names[kind]
        names.set(id, name)
        if (names.size > NAME_LIMIT) names.delete(names.keys().next().value!)
        this.namesDirty = true
        this.schedule()
      }
      return { name, complete: true }
    } catch (error) {
      if (unavailable(error)) return { name: null, complete: false }
      this.missing.set(key, this.now())
      return { name: null, complete: true }
    }
  }

  /**
   * The icon ID in the row of an Action or Status key, null when it has none. Without the game data open, one the
   * cache lacks fails with the error of the host, so the page asks again later.
   */
  async iconId(key: `${'action' | 'status'}:${number}`): Promise<number | null> {
    await this.checking
    if (this.iconIds.has(key)) return this.iconIds.get(key)!
    if (this.recentlyMissing(key)) return null
    const language = this.open
    if (language === null) throw Object.assign(new Error('Game data is not open'), { code: 'unavailable' })
    const [kind, id] = key.split(':')
    try {
      const row = (await this.data.rows(kind === 'action' ? 'Action' : 'Status', [Number(id)], language))[0]
      const cell = row?.subrows[0]?.cells[ICON_COLUMN]
      const icon = cell?.type === 'number' && cell.value > 0 ? cell.value : null
      this.iconIds.set(key, icon)
      this.indexDirty = true
      this.schedule()
      return icon
    } catch (error) {
      if (unavailable(error)) throw error
      this.missing.set(key, this.now())
      return null
    }
  }

  /** The values of a column by row ID; incomplete when some rows could not be read for want of game data */
  async columns(kind: ColumnKind, ids: number[]): Promise<{ values: Map<number, number>; complete: boolean }> {
    await this.checking
    const known = this.columnValues[kind]
    const values = new Map<number, number>()
    const wanted: number[] = []
    for (const id of ids) {
      const value = known.get(id)
      if (value !== undefined) values.set(id, value)
      else if (!this.recentlyMissing(`${kind}:${id}`)) wanted.push(id)
    }
    if (!wanted.length) return { values, complete: true }
    const language = this.open
    if (language === null) return { values, complete: false }
    const { sheet, index } = COLUMNS[kind]
    let complete = true
    const size = Math.max(1, this.rowIds)
    for (let start = 0; start < wanted.length; start += size) {
      const batch = wanted.slice(start, start + size)
      try {
        const read = new Set<number>()
        for (const row of await this.data.rows(sheet, batch, language)) {
          const cell = row.subrows[0]?.cells[index]
          if (cell?.type !== 'number') continue
          values.set(row.rowId, cell.value)
          known.set(row.rowId, cell.value)
          read.add(row.rowId)
        }
        for (const id of batch) if (!read.has(id)) this.missing.set(`${kind}:${id}`, this.now())
        this.indexDirty = true
      } catch (error) {
        if (unavailable(error)) complete = false
        else for (const id of batch) this.missing.set(`${kind}:${id}`, this.now())
      }
    }
    this.schedule()
    return { values, complete }
  }

  /** An icon by ID, null when the game data lacks it; without the game data open it fails as iconId does */
  async icon(id: number): Promise<CachedIcon | null> {
    await this.checking
    if (this.icons.has(id)) return this.icons.get(id)!
    if (this.stored.has(id)) {
      try {
        const icon = { mime: 'image/png', data: await this.storage.read(iconFile(id)) }
        this.icons.set(id, icon)
        return icon
      } catch {
        this.stored.delete(id)
        this.indexDirty = true
      }
    }
    if (this.open === null) throw Object.assign(new Error('Game data is not open'), { code: 'unavailable' })
    let result: CachedIcon | null
    try {
      const read = await this.data.icon(id)
      result = read && { mime: read.mime, data: read.data }
    } catch (error) {
      if (unavailable(error)) throw error
      result = null
    }
    this.icons.set(id, result)
    if (result && this.writable) await this.store(id, result.data)
    return result
  }

  /** Writes the index and the names when they changed */
  async flush() {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    if (!this.writable) return
    if (this.namesDirty && this.language) {
      this.namesDirty = false
      const names = Object.fromEntries(
        Object.entries(this.names).map(([kind, map]) => [kind, [...map]]),
      ) as unknown as Names
      await this.write(namesFile(this.language), names)
    }
    if (this.indexDirty) {
      this.indexDirty = false
      const index: Index = {
        version: this.version,
        language: this.language,
        iconIds: [...this.iconIds],
        cooldownGroup: [...this.columnValues.cooldownGroup],
        statusCategory: [...this.columnValues.statusCategory],
        icons: [...this.stored],
      }
      await this.write(INDEX, index)
    }
  }

  /** Drops everything, in memory and in storage */
  async clear() {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    const known = [INDEX, ...[...this.stored.keys()].map(iconFile)]
    if (this.language) known.push(namesFile(this.language))
    this.version = null
    this.writable = false
    this.names = { action: new Map(), status: new Map(), territoryType: new Map() }
    this.iconIds.clear()
    this.columnValues = { cooldownGroup: new Map(), statusCategory: new Map() }
    this.stored.clear()
    this.icons.clear()
    this.missing.clear()
    this.indexDirty = this.namesDirty = false
    await this.exclusive(async () => {
      // The listing fails once there are more files than the host lists, so the known files go as well.
      const listed = await this.storage.list(DIRECTORY).catch(() => [])
      for (const name of new Set([...known, ...listed])) await this.storage.delete(name).catch(() => {})
    })
  }

  private recentlyMissing(key: string) {
    return this.now() - (this.missing.get(key) ?? -Infinity) < RETRY_MS
  }
  private schedule() {
    if (!this.writable || (!this.indexDirty && !this.namesDirty) || this.timer !== null) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, FLUSH_MS)
  }
  /** Writes an icon file and drops the oldest ones over the limits */
  private async store(id: number, data: Uint8Array) {
    if (data.length > ICON_BYTES) return
    let used = data.length
    for (const size of this.stored.values()) used += size
    while (this.stored.size && (used > ICON_BYTES || this.stored.size >= ICON_LIMIT)) {
      const [oldest, size] = this.stored.entries().next().value!
      this.stored.delete(oldest)
      used -= size
      await this.exclusive(() => this.storage.delete(iconFile(oldest)).catch(() => {}))
    }
    this.indexDirty = true
    if (await this.writeBytes(iconFile(id), data)) this.stored.set(id, data.length)
    this.schedule()
  }
  private async loadNames(language: string) {
    const value = await this.readJson(namesFile(language))
    if (!value || typeof value !== 'object') return
    for (const kind of Object.keys(this.names) as NameKind[])
      for (const [id, name] of pairs((value as Record<string, unknown>)[kind]))
        if (isId(id) && typeof name === 'string') this.names[kind].set(id, name)
  }
  private async readJson(path: string): Promise<unknown> {
    try {
      return JSON.parse(new TextDecoder().decode(await this.storage.read(path)))
    } catch (error) {
      if (!notFound(error)) this.warn('游戏数据缓存读取失败', error)
      return null
    }
  }
  private async write(path: string, value: unknown) {
    return this.writeBytes(path, new TextEncoder().encode(JSON.stringify(value)))
  }
  private async writeBytes(path: string, bytes: Uint8Array) {
    try {
      await this.exclusive(() => this.storage.write(path, bytes))
      return true
    } catch (error) {
      this.warn('游戏数据缓存写入失败', error)
      return false
    }
  }
  /** A cache that cannot be read or written keeps working in memory, so it says so only once. */
  private warn(message: string, error: unknown) {
    if (this.warned) return
    this.warned = true
    this.log.warn(message, { error: String((error as { message?: string } | null)?.message ?? error) })
  }
  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const next = this.writing.then(task)
    this.writing = next.catch(() => {})
    return next
  }
}
