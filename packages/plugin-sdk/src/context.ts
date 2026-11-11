import type { Limits } from './limits.js'
import type {
  ApiError,
  BatchListener,
  Capability,
  ClockState,
  Disposer,
  EventsService,
  FeatureDefinition,
  Field,
  Json,
  OverlayDefinition,
  PacketsService,
  PluginIdentity,
  PreferenceItem,
  Sample,
  SessionService,
  Status,
  SubscribeOptions,
  Subscription,
  Value,
  ViewIdentity,
} from './types.js'

export interface PlayerFields {
  actorId: number | null
  contentId: bigint
  name: string
  classJob: number
  /** `Race` row: 1 Hyur … 8 Viera; players only */
  race: number
  level: number
  hpCur: number
  hpMax: number
  mpCur: number
  mpMax: number
  gpCur: number
  gpMax: number
  cpCur: number
  cpMax: number
  targetId: number | null
  inCombat: boolean
  position: { x: number; y: number; z: number }
  rotation: number
  statuses: Status[]
  attributes: Record<string, number>
  jobGauge: Value
}
export interface CombatantFields {
  weaponId: number
  modelStatus: number
  parentId: number | null
  tetherId: number
  animationState: number
  name: string
  objectKind: number
  /** `GameObject.SubKind`; a `BattleNpcSubKind` when `objectKind` is 2. */
  subKind: number
  classJob: number
  /** `Race` row: 1 Hyur … 8 Viera; players only */
  race: number
  level: number
  hpCur: number
  hpMax: number
  mpCur: number
  mpMax: number
  position: { x: number; y: number; z: number }
  rotation: number
  ownerId: number | null
  bNpcBase: number
  bNpcName: number
  currentWorldId: number
  homeWorldId: number
  targetId: number | null
  cast: { actionId: number; currentMs: number; totalMs: number } | null
  statuses: Status[]
}
export type PlayerField = keyof PlayerFields
export type CombatantField = keyof CombatantFields
export type PlayerState = { [K in PlayerField]?: Field<PlayerFields[K]> }
export type CombatantState = { id: number } & { [K in CombatantField]?: Field<CombatantFields[K]> }
export interface GameTopics {
  player: PlayerState
  target: Field<number | null>
  entities: { entities: CombatantState[]; missingIds: number[] }
  party: { isInParty: Field<boolean>; members: Field<{ slot: number; id: number; name: string; ownParty: boolean }[]> }
  zone: { territoryType: Field<number>; mapId: Field<number> }
}
export interface GameService {
  getPlayer(selection: { fields: PlayerField[] }, options?: SubscribeOptions): Promise<Sample<PlayerState>>
  getCombatants(
    selection: { ids?: number[]; fields: CombatantField[]; limit?: number },
    options?: SubscribeOptions,
  ): Promise<Sample<GameTopics['entities']>>
  subscribe<T extends keyof GameTopics>(
    topic: T,
    listener: BatchListener<Sample<GameTopics[T]>>,
    options?: SubscribeOptions & { ids?: number[]; fields?: (PlayerField | CombatantField)[]; intervalMs?: number },
  ): Subscription
}
export type MemorySignature =
  | { kind: 'builtin'; name: string }
  | { kind: 'pattern'; pattern: string; protection: 'executable' | 'readable' | 'writable'; alignment: number }
export interface MemorySelection {
  sessionId: string
  characterGeneration: number
  ranges: { key: string; address: number; length: number }[]
}
export type MemoryResult = { data: Uint8Array } | { error: ApiError }
export interface MemoryService {
  resolve(
    signature: MemorySignature,
    options?: SubscribeOptions & { all?: boolean },
  ): Promise<Sample<{ addresses: number[]; build: string | null }>>
  read(selection: MemorySelection, options?: SubscribeOptions): Promise<Record<string, Sample<MemoryResult>>>
  watch(
    selection: MemorySelection,
    listener: BatchListener<Sample<MemoryResult & { key: string }>>,
    options?: SubscribeOptions & { intervalMs?: number },
  ): Subscription
}
export type Cell =
  | { type: 'string'; value: string }
  | { type: 'number'; value: number }
  | { type: 'boolean'; value: boolean }
  | { type: 'bigint'; value: bigint }
export interface DataRow {
  rowId: number
  subrows: { subrowId: number | null; cells: Cell[] }[]
}
export interface GameIcon {
  mime: 'image/png'
  width: number
  height: number
  data: Uint8Array
}
export interface DataService {
  rowIds(sheet: string, language: string, options?: SubscribeOptions): Promise<number[]>
  resource(path: string, options?: SubscribeOptions): Promise<Uint8Array | null>
  image(path: string, options?: SubscribeOptions): Promise<string | null>
  map(id: string, options?: SubscribeOptions): Promise<string | null>
  icon(id: number, options?: SubscribeOptions): Promise<GameIcon | null>
  name(
    kind: 'action' | 'status' | 'placeName' | 'territoryType' | 'map',
    id: number,
    language: string,
    options?: SubscribeOptions,
  ): Promise<string>
  rows(sheet: string, ids: number[], language: string, options?: SubscribeOptions): Promise<DataRow[]>
  /**
   * The version of the open game data, the content of ffxivgame.ver in the game directory; null when the file is
   * missing or empty. Read again on each call, so it changes once the game is updated.
   * @since Plugin API 1.4.0
   */
  version(options?: SubscribeOptions): Promise<string | null>
}
export interface UiService {
  registerFeature(definition: FeatureDefinition, options?: SubscribeOptions): Promise<Disposer>
  registerOverlay(definition: OverlayDefinition, options?: SubscribeOptions): Promise<Disposer>
  /**
   * Replaces every preference item submitted before with these; an empty array clears them. The host's settings search
   * and command palette find them while the plugin has a settings page. They belong to this activation and are gone
   * once the plugin stops. On failure the previous items stay.
   * @since Plugin API 1.5.0
   */
  setPreferenceItems(items: readonly PreferenceItem[]): Promise<void>
}
export interface PluginNotification {
  /** 1 to 80 characters */
  title: string
  /** 0 to 500 characters; an empty string when omitted */
  detail?: string
}
export interface NotificationsService {
  /**
   * Adds a notification to the Mojito notification list, kept until Mojito exits.
   * @since Plugin API 1.6.0
   */
  send(notification: PluginNotification, options?: SubscribeOptions): Promise<void>
}
export interface ViewsService {
  /**
   * Stores the latest value of a channel. Values set in quick succession are merged and sent to the host
   * at most every 200ms, so the value must not be modified afterwards. A value the host rejected makes
   * the next `set` or `flush` throw.
   */
  set(channel: string, value: Value): void
  /** Sends every value not yet sent and resolves once the host handled them. */
  flush(options?: SubscribeOptions): Promise<void>
  onCommand(
    channel: string,
    handler: (value: Value, view: ViewIdentity) => Value | Promise<Value>,
    options?: SubscribeOptions,
  ): Promise<Disposer>
}
export interface AudioService {
  say(text: string, options: SubscribeOptions & { language: string }): Promise<void>
  play(resource: { path: string }, options?: SubscribeOptions & { volume?: number }): Promise<void>
}
export interface HostService {
  /** Asks the user, showing the whole address, before opening an http: or https: link in the browser */
  openExternal(url: string, options?: SubscribeOptions): Promise<'opened' | 'cancelled'>
}
export interface HttpOptions extends SubscribeOptions {
  method?: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  headers?: Record<string, string>
  body?: string | Uint8Array
  credentials?: 'omit' | 'include'
  timeoutMs?: number
}
export interface HttpService {
  request(
    url: string,
    options?: HttpOptions,
  ): Promise<{ status: number; headers: Record<string, string>; body: Uint8Array; url: string }>
}
export interface ConfigService {
  get(key: string, options?: SubscribeOptions): Promise<Json>
  set(key: string, value: Json, options?: SubscribeOptions): Promise<void>
}
export interface StorageService {
  read(path: string, options?: SubscribeOptions): Promise<Uint8Array>
  write(path: string, bytes: Uint8Array, options?: SubscribeOptions): Promise<void>
  delete(path: string, options?: SubscribeOptions): Promise<void>
  list(path: string, options?: SubscribeOptions): Promise<string[]>
}
export interface LogService {
  debug(message: string, fields?: Json): void
  info(message: string, fields?: Json): void
  warn(message: string, fields?: Json): void
  error(message: string, fields?: Json): void
}
export interface ClockService {
  now(): number | null
  state(): ClockState
  sleep(ms: number, options?: SubscribeOptions): Promise<void>
  setTimeout(callback: () => void | Promise<void>, ms: number): Disposer
}
export interface CallContext {
  readonly signal: AbortSignal
  readonly session: SessionService
  readonly game: GameService
  readonly events: EventsService
  readonly packets: PacketsService
  readonly memory: MemoryService
  readonly data: DataService
}
export interface ServiceDefinition {
  /** What the service does, without the plugin ID; others use it as `pluginId/name` */
  name: string
  version: string
}
export interface ServiceProvider {
  /** The full name, `pluginId/name` */
  service: string
  version: string
}
/** One call to a service this plugin provides; the provider answers with its own capabilities */
export interface ServiceRequestContext {
  readonly signal: AbortSignal
  /** The plugin that made the call */
  readonly consumerId: string
}
export interface ServicesService {
  provide(
    definition: ServiceDefinition,
    handler: (request: { method: string; payload: Value }, context: ServiceRequestContext) => Value | Promise<Value>,
    options?: SubscribeOptions,
  ): Promise<Disposer>
  /** name is the local name given to provide */
  publish(name: string, event: string, payload: Value, options?: SubscribeOptions): Promise<void>
  /** The provider of a service this plugin declares in services.consumes, or null when it is not running or too old */
  connect(service: string, versionRange: string, options?: SubscribeOptions): Promise<ServiceProvider | null>
  request(service: string, method: string, payload: Value, options?: SubscribeOptions): Promise<Value>
  subscribe(
    selector: { service: string; event: string },
    listener: BatchListener<Value>,
    options?: SubscribeOptions,
  ): Subscription
}
export interface PluginContext extends CallContext {
  readonly identity: Readonly<PluginIdentity>
  readonly limits: Limits
  /** The state of each capability the plugin declares; capabilitiesChanged updates it when the user changes a choice */
  readonly capabilities: { get(): Record<string, Capability> }
  readonly ui: UiService
  readonly views: ViewsService
  readonly audio: AudioService
  readonly host: HostService
  readonly http: HttpService
  readonly config: ConfigService
  readonly storage: StorageService
  readonly log: LogService
  readonly notifications: NotificationsService
  readonly clock: ClockService
  readonly services: ServicesService
}
// biome-ignore lint/suspicious/noConfusingVoidType: The approved activate contract accepts synchronous and async void.
export type Activate = (context: PluginContext) => void | Disposer | Promise<void | Disposer>
