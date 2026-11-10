import type { DataService, LogService, StorageService } from '@ffcafe/mojito-plugin-sdk'

/** The storage the cache may take; the combat log keeps out of it */
export const GAME_CACHE_BYTES = 16 * 1024 * 1024
/** Names kept of each kind; the oldest go first */
const NAME_LIMIT = 8000
/** The size of the icon file at most; the icons asked for longest ago are left out */
const ICON_BYTES = 12 * 1024 * 1024
/** How long after the last change the index and the names are written */
const FLUSH_MS = 2000
/** A name, icon row or column that could not be read is asked for again after this long */
const RETRY_MS = 60_000
const DIRECTORY = 'game-data'
const INDEX = `${DIRECTORY}/index.json`
const namesFile = (language: string) => `${DIRECTORY}/names-${language}.json`
/** Every icon in one file, so a review costs the host a few writes and one read instead of one per icon */
const ICONS = `${DIRECTORY}/icons.bin`
/** Where an older version kept one file per icon */
const OLD_ICONS = `${DIRECTORY}/icons`
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
  format: 2
  version: string | null
  language: string | null
  iconIds: [string, number | null][]
  cooldownGroup: [number, number][]
  statusCategory: [number, number][]
}
type Names = Record<NameKind, [number, string][]>
type StoredIcon = { id: number; data: Uint8Array; lastUsed: number }

/** The host has no game data open, as opposed to a row or icon the open data lacks. */
function unavailable(error: unknown) {
  return (error as { code?: string } | null)?.code === 'unavailable'
}
const notFound = (error: unknown) => (error as { code?: string } | null)?.code === 'not_found'
/** The open game data has no such row or icon; any other failure may pass, such as the host refusing for load. */
const absent = (error: unknown) => {
  const code = (error as { code?: string } | null)?.code
  return code === 'not_found' || code === 'invalid_argument'
}
const pairs = (value: unknown): [unknown, unknown][] =>
  Array.isArray(value)
    ? value.filter((item): item is [unknown, unknown] => Array.isArray(item) && item.length === 2)
    : []
const isId = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0
const numbers = (value: unknown) =>
  new Map(pairs(value).filter((item): item is [number, number] => isId(item[0]) && typeof item[1] === 'number'))

/**
 * The icon file: a u32 little-endian length of the directory, the directory as UTF-8 JSON of
 * `[id, offset, length, lastUsed]` with the offset from the start of the data, then the data of each icon.
 */
function encodeIcons(entries: StoredIcon[]): Uint8Array {
  let offset = 0
  const directory = entries.map(({ id, data, lastUsed }) => {
    const entry = [id, offset, data.length, lastUsed]
    offset += data.length
    return entry
  })
  const head = new TextEncoder().encode(JSON.stringify(directory))
  const bytes = new Uint8Array(4 + head.length + offset)
  new DataView(bytes.buffer).setUint32(0, head.length, true)
  bytes.set(head, 4)
  let at = 4 + head.length
  for (const { data } of entries) {
    bytes.set(data, at)
    at += data.length
  }
  return bytes
}
/** The icons of a file, null when any part of it does not hold together */
function decodeIcons(bytes: Uint8Array): StoredIcon[] | null {
  if (bytes.length < 4) return null
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true)
  if (length > bytes.length - 4) return null
  let directory: unknown
  try {
    directory = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + length)))
  } catch {
    return null
  }
  if (!Array.isArray(directory)) return null
  const data = bytes.subarray(4 + length)
  const icons: StoredIcon[] = []
  for (const entry of directory) {
    if (!Array.isArray(entry) || entry.length !== 4) return null
    const [id, offset, size, lastUsed] = entry as unknown[]
    if (!isId(id) || !isId(offset) || !isId(size) || typeof lastUsed !== 'number' || !Number.isFinite(lastUsed))
      return null
    if (offset + size > data.length) return null
    icons.push({ id, data: data.subarray(offset, offset + size), lastUsed })
  }
  return icons
}

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
  /** Icons of the icon file and those read in this activation; null for one the game data lacks */
  private icons = new Map<number, CachedIcon | null>()
  /** When each icon was last asked for, by which the file keeps the most recent ones */
  private lastUsed = new Map<number, number>()
  /** Reading the icon file, done once and only when an icon is first wanted */
  private iconsLoaded: Promise<void> | null = null
  /** Icons read from the game data that the icon file lacks */
  private iconsDirty = false
  /** When something could not be read, by `${kind}:${id}`; never stored */
  private missing = new Map<string, number>()
  private indexDirty = false
  private namesDirty = false
  private readonly iconBytes: number
  private timer: ReturnType<typeof setTimeout> | null = null
  private warned = false
  private checking: Promise<void> = Promise.resolve()
  /** Storage operations run one at a time, so a clear never races a write */
  private writing: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly storage: StorageService,
    private readonly data: GameData,
    private readonly log: Pick<LogService, 'warn'>,
    private readonly limits: { rowIds: number; fileBytes: number },
    private readonly now: () => number = Date.now,
  ) {
    this.iconBytes = Math.min(ICON_BYTES, limits.fileBytes)
  }

  /** Reads what an earlier activation stored */
  async load() {
    const index = await this.readJson(INDEX)
    if (!index || typeof index !== 'object') return
    // `icons` is what an older version listed of its icon files.
    const value = index as Partial<Record<keyof Index | 'icons', unknown>>
    this.version = typeof value.version === 'string' ? value.version : null
    this.language = typeof value.language === 'string' ? value.language : null
    for (const [key, id] of pairs(value.iconIds))
      if (typeof key === 'string' && (id === null || isId(id))) this.iconIds.set(key, id)
    for (const kind of Object.keys(COLUMNS) as ColumnKind[]) this.columnValues[kind] = numbers(value[kind])
    if (value.format !== 2) {
      // An older version kept one file per icon. Deleting hundreds of them takes a while, so it runs behind the
      // activation, and the icons are read from the game data again.
      this.indexDirty = true
      const old = [...numbers(value.icons).keys()].map((id) => `${OLD_ICONS}/${id}.png`)
      void this.exclusive(async () => {
        const listed = await this.storage.list(OLD_ICONS).catch(() => [])
        for (const name of new Set([...old, ...listed])) await this.storage.delete(name).catch(() => {})
      })
    }
    if (this.language) await this.loadNames(this.language)
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
   * The icon ID in the row of an Action or Status key, null when the game data has no such row or it has no icon. Any
   * other failure, the game data not being open among them, is thrown and nothing is kept, so the page asks again.
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
      if (!absent(error)) throw error
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
    const size = Math.max(1, this.limits.rowIds)
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

  /** An icon by ID, null when the game data lacks it; any other failure is thrown and nothing is kept, as in iconId */
  async icon(id: number): Promise<CachedIcon | null> {
    await this.checking
    await this.loadIcons()
    if (this.icons.has(id)) {
      const icon = this.icons.get(id)!
      if (icon) this.lastUsed.set(id, this.now())
      return icon
    }
    if (this.open === null) throw Object.assign(new Error('Game data is not open'), { code: 'unavailable' })
    let result: CachedIcon | null
    try {
      const read = await this.data.icon(id)
      result = read && { mime: read.mime, data: read.data }
    } catch (error) {
      if (!absent(error)) throw error
      result = null
    }
    this.icons.set(id, result)
    if (result) {
      this.lastUsed.set(id, this.now())
      // The write waits for the debounce, so the page gets the icon at once.
      this.iconsDirty = true
      this.schedule()
    }
    return result
  }

  /** Writes the icons, the index and the names when they changed */
  async flush() {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    if (!this.writable) return
    if (this.iconsDirty) {
      // The file is rewritten whole, so what it held must be in memory first.
      await this.loadIcons()
      const entries: StoredIcon[] = []
      for (const [id, icon] of this.icons)
        if (icon) entries.push({ id, data: icon.data, lastUsed: this.lastUsed.get(id) ?? 0 })
      entries.sort((a, b) => b.lastUsed - a.lastUsed)
      // 6 bytes for the length and the brackets of the directory; an entry of it takes 48 at most, with its comma.
      let used = 6
      const kept: StoredIcon[] = []
      for (const entry of entries) {
        if (entry.data.length + 54 > this.iconBytes) continue
        if (used + entry.data.length + 48 > this.iconBytes) break
        used += entry.data.length + 48
        kept.push(entry)
      }
      this.iconsDirty = false
      if (!(await this.writeBytes(ICONS, encodeIcons(kept)))) this.iconsDirty = true
    }
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
        format: 2,
        version: this.version,
        language: this.language,
        iconIds: [...this.iconIds],
        cooldownGroup: [...this.columnValues.cooldownGroup],
        statusCategory: [...this.columnValues.statusCategory],
      }
      await this.write(INDEX, index)
    }
  }

  /** Drops everything, in memory and in storage */
  async clear() {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    const known = [INDEX, ICONS]
    if (this.language) known.push(namesFile(this.language))
    this.version = null
    this.writable = false
    this.names = { action: new Map(), status: new Map(), territoryType: new Map() }
    this.iconIds.clear()
    this.columnValues = { cooldownGroup: new Map(), statusCategory: new Map() }
    this.icons.clear()
    this.lastUsed.clear()
    this.iconsLoaded = Promise.resolve()
    this.missing.clear()
    this.indexDirty = this.namesDirty = this.iconsDirty = false
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
    if (!this.writable || (!this.indexDirty && !this.namesDirty && !this.iconsDirty) || this.timer !== null) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, FLUSH_MS)
  }
  /** Reads the icon file once; a file that cannot be read is left for the next write to replace */
  private loadIcons(): Promise<void> {
    if (this.iconsLoaded) return this.iconsLoaded
    const loading: Promise<void> = this.readIcons().then((icons) => {
      // A clear while reading leaves the file from before it.
      if (!icons || this.iconsLoaded !== loading) return
      for (const { id, data, lastUsed } of icons) {
        if (this.icons.has(id)) continue
        this.icons.set(id, { mime: 'image/png', data })
        this.lastUsed.set(id, lastUsed)
      }
    })
    this.iconsLoaded = loading
    return loading
  }
  private async readIcons(): Promise<StoredIcon[] | null> {
    let bytes: Uint8Array
    try {
      bytes = await this.storage.read(ICONS)
    } catch (error) {
      if (!notFound(error)) this.warn('游戏数据缓存读取失败', error)
      return null
    }
    const icons = decodeIcons(bytes)
    if (!icons) this.warn('游戏数据缓存读取失败', new Error(`${ICONS} is damaged`))
    return icons
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
