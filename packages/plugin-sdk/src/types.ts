/** Data contracts only: importing the SDK does not activate a plugin or open a host channel. */
export type Disposer = () => void | Promise<void>
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type Value = null | boolean | number | string | bigint | Uint8Array | Value[] | { [key: string]: Value }
export type TimeBase = 'packet-unix' | 'host-monotonic-unix'
export type Capability = { state: 'available' } | { state: 'unavailable'; reason: string }

export type CapabilityName =
  | 'session.read'
  | 'game.read'
  | 'events.read'
  | 'packets.read'
  | 'memory.read'
  | 'data.read'
  | 'ui.register'
  | 'ui.overlayplugin'
  | 'ui.overlayplugin.remote'
  | 'audio.play'
  | 'http.request'
  | 'host.files'
  | 'host.openExternal'
  | 'services.provide'
  | 'services.consume'

export interface PluginIdentity {
  id: string
  version: string
  activationId: string
  mode: 'worker' | 'native'
  environment: 'production' | 'development'
}

export interface SourceMeta {
  sessionId: string
  characterGeneration: number
  source: 'live' | 'replay'
  observedAt: number
  timeBase: TimeBase
  clockGeneration: number
  sampleStartedAt: number | null
  sampleEndedAt: number | null
}
export interface Sample<T> {
  meta: SourceMeta
  value: T
}
export type Field<T> =
  | { state: 'ok'; value: T; observedAt: number; timeBase: TimeBase; from: 'memory' | 'packet' }
  | { state: 'unknown'; reason: string }
  | { state: 'unavailable'; reason: string }

export interface ApiError {
  code:
    | 'invalid_argument'
    | 'permission_denied'
    | 'unavailable'
    | 'not_found'
    | 'stale_session'
    | 'cancelled'
    | 'timeout'
    | 'quota_exceeded'
    | 'overflow'
    | 'source_incomplete'
    | 'incompatible_version'
    | 'plugin_stopped'
    | 'clock_reset'
    | 'internal'
  message: string
  retryable: boolean
}

export interface Batch<T> {
  subscriptionId: string
  batchId: number
  firstSeq: number
  lastSeq: number
  initial: boolean
  complete: boolean
  items: T[]
}
export interface SubscribeOptions {
  signal?: AbortSignal
}
export interface Subscription {
  ready: Promise<void>
  dispose(): void
  closed: Promise<{ reason: string; error?: ApiError }>
}
export type BatchListener<T> = (batch: Batch<T>) => void | Promise<void>

export type ClockState = Readonly<{
  now: number | null
  base: TimeBase | null
  generation: number
  source: 'live' | 'replay' | null
  paused: boolean
}>
export interface SessionSnapshot {
  state: 'idle' | 'live' | 'replay'
  sessionId: string | null
  characterGeneration: number
  process: { pid: number; name: string } | null
  build: string | null
  region: string | null
  login: 'unknown' | 'logged-out' | 'logged-in'
  character: { actorId: number | null; contentId: bigint | null } | null
  uiLanguage: string
  dataLanguage: string | null
  capabilities: Record<string, Capability>
  grantedCapabilities: string[]
  clock: ClockState
}

export interface Status {
  statusId: number
  param: number
  sourceActorId: number | null
  durationMs: number | null
  observedAt: number
}
export interface Effect {
  effectIndex?: number
  typeCode: number
  critical: boolean
  direct: boolean
  rawFlags: number
  rawParam: number
  rawValue: number
  rawBonusPercent: number
}
export interface EffectTarget {
  targetPosition: Field<{ x: number; y: number; z: number }>
  targetIndex?: number
  targetId: number | null
  effects: Effect[]
}
export interface PeriodicTick {
  estimatorGeneration: number
  tickId: number
  occurredAt: number
  target: number | null
  isHeal: boolean
  statusId: number
  total: number
  unknown: number
  confirmed: boolean
  phase: 'realtime' | 'post'
  shares: {
    sourceId: number | null
    statusId: number
    amount: number
    basis: 'exact' | 'sourceExact' | 'estimated' | 'unconfirmed'
  }[]
}
/** One part of a damage given to the status of a player */
export interface AttributionPart {
  statusId: number
  /** The player who gave the status; the owner when a pet gave it */
  sourceId: number | null
  amount: number
}
/** A damage of a player, split as it came */
export interface DamageAttribution {
  estimatorGeneration: number
  /** Increases within estimatorGeneration; attributionRevision refers to it */
  id: number
  origin:
    | { type: 'action'; actionId: number; sequence: number }
    /** statusId: the status of the share or of the separately sent tick */
    | { type: 'tick'; tickId: number; statusId: number }
  /** The player the damage counts for: who dealt it, or the owner of the pet that dealt it */
  attackerId: number | null
  /** Who dealt it: the attacker or a pet of the attacker */
  actorId: number | null
  targetId: number | null
  amount: number
  /** amount without the contributions and the unattributed part */
  retained: number
  /** The part the modifiers of sources that are not players gave */
  unattributed: number
  /** Sorted by sourceId, then statusId; never the attacker */
  contributions: AttributionPart[]
}
/** How the split of one damage changed when its window closed: the result after the window minus the realtime one */
export interface AttributionDelta {
  /** The id of the realtime damageAttributed; null for a share of a summed tick */
  id: number | null
  /** The tickId of the summed tick; null otherwise */
  tickId: number | null
  actorId: number | null
  origin: { type: 'action'; actionId: number } | { type: 'tick'; statusId: number }
  unattributed: number
  /** amount is the change; a part the realtime split did not have, or the one after the window does not have, is included */
  contributions: AttributionPart[]
}
export interface GameEventMap {
  actorMoved: { actorId: number; position: { x: number; y: number; z: number }; rotation: number; moveType: number }
  actorPositionSet: { actorId: number; position: { x: number; y: number; z: number }; rotation: number }
  mapEffect: { directorId: number | null; index: number; state: number; timelineIndex: number }
  systemLogMessage: { instance: number; messageId: number; params: number[] }
  npcYell: { npcId: number | null; npcNameId: number; npcYellId: number }
  battleTalk: {
    npcId: number | null
    instance: number
    npcNameId: number
    instanceContentTextId: number
    displayMs: number
    params: number[]
  }
  countdownStarted: { actorId: number | null; worldId: number; durationMs: number; result: number; name: string }
  countdownCancelled: { actorId: number | null; worldId: number; name: string }
  gameLog: { time: number; code: number; sender: Uint8Array; message: Uint8Array }
  periodicTick: PeriodicTick
  periodicRevision: { estimatorGeneration: number; ticks: PeriodicTick[] }
  damageAttributed: DamageAttribution
  /** A hit of a calibration action that was neither critical nor direct, as the host measured its damage per potency */
  potencySample: {
    casterId: number | null
    targetId: number | null
    actionId: number
    /** The global sequence of the actionEffect it came from */
    sequence: number
    amount: number
    /** The potency at the level of the caster, times the potency modifiers of the gauge */
    potency: number
    /** The product of the damage multipliers of the statuses the host knows */
    multiplier: number
    factors: { statusId: number; sourceId: number | null; holder: 'caster' | 'target'; value: number }[]
  }
  attributionRevision: { estimatorGeneration: number; records: AttributionDelta[] }
  playerCombatChanged: { actorId: number; inCombat: boolean }
  castStarted: {
    casterId: number | null
    actionId: number
    targetId: number | null
    durationMs: number
    sourcePosition: Field<{ x: number; y: number; z: number }>
    sourceRotation: Field<number>
    targetPosition: Field<{ x: number; y: number; z: number }>
    castPosition: Field<{ x: number; y: number; z: number }>
    castRotation: Field<number>
  }
  castCancelled: { casterId: number | null; actionId: number; interrupted: boolean }
  actorControl: { actorId: number | null; category: number; params: number[]; self: boolean }
  npcSpawn: { actorId: number; parentId: number | null; tetherId: number; animationState: number }
  nameplateChanged: { actorId: number | null; visible: boolean }
  actionEffect: {
    sourcePosition: Field<{ x: number; y: number; z: number }>
    sourceRotation: Field<number>
    effectRotation: Field<number>
    animationTargetId: number | null
    effectPosition: Field<{ x: number; y: number; z: number }>
    dataFlag: number
    sourceActorId: number | null
    actionId: number
    actionType: number
    sequence: number
    isAoe: boolean
    targets: EffectTarget[]
  }
  actorDied: { actorId: number | null; causedByActorId: number | null }
  hpChanged: {
    origin: 'effectResult' | 'effectResultBasic' | 'hpUpdate'
    actorId: number | null
    hpCur: number
    /** Only EffectResult carries the maximum HP; EffectResultBasic and UpdateHpMpTp are null */
    hpMax: number | null
    /** The global sequence of an EffectResult(Basic) entry, equal to that of its actionEffect; null for UpdateHpMpTp */
    sequence: number | null
  }
  /** Slot is present on hosts >=1.7.0; older persisted events can lack it. */
  statusesReplaced: { actorId: number | null; statuses: (Status & { slot?: number })[] }
  statusChanged: { actorId: number | null; slot: number; status: Status | null }
  zoneChanged: { territoryTypeId: number }
  /** A character became targetable or untargetable; also sent once when the character is first seen */
  targetableChanged: { actorId: number; targetable: boolean }
  /** The local player started or stopped watching a cutscene */
  cutsceneChanged: { playing: boolean }
}
/** Distribute over T so narrowing event.type also narrows event.data. */
export type GameEvent<T extends keyof GameEventMap = keyof GameEventMap> = {
  [K in T]: {
    type: K
    data: GameEventMap[K]
  } & (K extends
    | 'periodicTick'
    | 'periodicRevision'
    | 'damageAttributed'
    | 'potencySample'
    | 'attributionRevision'
    | 'gameLog'
    | 'targetableChanged'
    | 'cutsceneChanged'
    ? { packet?: { seq: number; timestamp: number; sourceActorId: number; targetActorId: number } }
    : { packet: { seq: number; timestamp: number; sourceActorId: number; targetActorId: number } })
}[T]
export interface EventOptions extends SubscribeOptions {
  actorIds?: number[]
  actionIds?: number[]
  statusIds?: number[]
}
export interface EventsService {
  subscribe<T extends keyof GameEventMap>(
    type: T | readonly T[],
    listener: BatchListener<Sample<GameEvent<T>>>,
    options?: EventOptions,
  ): Subscription
}
export interface Packet {
  seq: number
  timestamp: number
  direction: 'recv' | 'send'
  channel: 'zone' | 'chat' | 'lobby'
  opcode: number
  type: string | null
  sourceActor: number
  targetActor: number
  serverId: number
  ipcTimestamp: number
  data: Uint8Array
}
export interface PacketOptions extends SubscribeOptions {
  directions?: Packet['direction'][]
  channels?: Packet['channel'][]
  opcodes?: number[]
  types?: string[]
}
export interface PacketsService {
  subscribe(selector: 'ipc', listener: BatchListener<Sample<Packet>>, options?: PacketOptions): Subscription
}
export interface SessionService {
  get(options?: SubscribeOptions): Promise<SessionSnapshot>
  subscribe(listener: BatchListener<SessionSnapshot>, options?: SubscribeOptions): Subscription
}

export type FeaturePlacement = 'sidebar' | 'home' | 'settings'
export interface FeatureDefinition {
  /** Host location; sidebar by default. One home and one settings page per plugin. */
  placement?: FeaturePlacement
  id: string
  name: string
  icon?: string
  entry: string
}
export type OverlayDefinition = {
  id: string
  name: string
  defaultSize: { width: number; height: number }
} & (
  | { entry: string; compatibility?: never }
  | { entry?: never; compatibility: import('./overlayplugin.js').OverlayCompatibility }
)
/**
 * A setting on the plugin's settings page that the host's settings search and command palette can find.
 * @since Plugin API 1.5.0
 */
export interface PreferenceItem {
  /** The format of a feature ID; unique within one submission */
  id: string
  /** 1–100 characters */
  title: string
  /** 0–300 characters */
  description: string
}
/** The user chose a preference item in the host's settings search or command palette. */
export interface NavigateToPreferenceItem {
  id: string
  /** What the user had typed in the search box, without surrounding whitespace; may be pinyin or initials */
  keyword: string
}
/** Events the host sends to a page; see `ViewBridge.on`. */
export interface ViewEvents {
  'navigate-to-preference-item': NavigateToPreferenceItem
}
export interface ViewIdentity {
  viewId: string
  kind: 'feature' | 'overlay'
  definitionId: string
  instanceId: string | null
  placement: FeaturePlacement | null
}
