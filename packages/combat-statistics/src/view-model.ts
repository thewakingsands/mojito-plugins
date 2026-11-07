import type { FightEntry } from './log/types.js'
import type { Settings, Summary } from './model.js'
import type { VisitQuery } from './visit-filter.js'

/** The fight shown in the overview. */
export interface Selection {
  visitId: string
  fightId: string
}
export interface VisitView {
  id: string
  territoryType: number
  zoneName: string | null
  enteredAt: number
  leftAt: number | null
  current: boolean
  /** Whether the fights of this visit can be read from the log; loading while it is being recomputed. */
  status: 'ok' | 'loading' | 'failed'
  error: string | null
  fights: FightEntry[]
}
/**
 * The `visits` view channel: one page of the visits with a fight that match the query, newest first. It changes when a
 * visit or fight starts or ends, a visit or an older log file is read, or the query or page changes.
 */
export interface VisitsState {
  visits: VisitView[]
  query: VisitQuery
  /** From 0 */
  page: number
  hasPrevious: boolean
  /** False as well while older files are read and it is not known yet */
  hasNext: boolean
  /** Older log files are being read to fill the page */
  reading: boolean
  /** The visit of the selected fight, wherever it is listed */
  selected: VisitView | null
}
/** The `statistics` view channel; it is published every second while a fight runs. */
export interface StatisticsState {
  /** The fight in progress or the last one of this activation, as the overlays show it */
  current: Summary | null
  activeFightId: string | null
  /** Whether the selection follows the current fight */
  following: boolean
  selection: Selection | null
  selected: Summary | null
  /** Set while the selected visit is recomputed from the log */
  loading: boolean
  loadError: string | null
  /** Names of the skills of the selected fight by skill key, and job abbreviations by `job:<ClassJob ID>` */
  names: Record<string, string>
  settings: Settings
  inputError: string | null
  /** Set while an input of the statistics is unavailable, so nothing is counted or logged */
  paused: boolean
  inCombat: boolean | null
}
export type Command =
  | { kind: 'select'; visitId: string; fightId: string }
  | { kind: 'current' }
  | { kind: 'settings'; value: Settings }
  | { kind: 'clear' }
  | { kind: 'icon'; key: string }
  | { kind: 'replay'; visitId: string; fightId: string }
  | { kind: 'visits'; query: VisitQuery; page: number }

/**
 * Positions of one actor, a sample per column index in time order. Times are review times: milliseconds from the
 * start of the fight.
 */
export interface Track {
  t: Uint32Array
  x: Float32Array
  z: Float32Array
  rotation: Float32Array
  /** hpCur ÷ hpMax, NaN when unknown */
  hp: Float32Array
}
/** Each use of an action by a member, its pets' uses under the member */
export interface Uses {
  t: Uint32Array
  /** Index into ReplayData.actors */
  actor: Uint16Array
  /** Index into ReplayData.actions */
  action: Uint16Array
}
export const ENTRY_FIELDS = ['damage', 'healing', 'taken', 'overheal', 'given', 'received'] as const
export type EntryField = (typeof ENTRY_FIELDS)[number]
export const HIT_DIRECT = 1
export const HIT_CRITICAL = 2
export const HIT_DIRECT_HIT = 4
/** What the ledger booked for members and their pets */
export interface Entries {
  t: Uint32Array
  /** Index into actors of whose row it is on */
  actor: Uint16Array
  /** Index into actors of the target of damage and healing, the source of taken; -1 when not an actor or none */
  other: Int32Array
  /** Index into ReplayData.skills */
  skill: Uint16Array
  /** Index into ENTRY_FIELDS */
  field: Uint8Array
  /** HIT_DIRECT, HIT_CRITICAL and HIT_DIRECT_HIT bits */
  hit: Uint8Array
  /** Below zero where a revision takes back what was booked before */
  amount: Float64Array
}
export interface ReplayActor {
  /** Its index in ReplayData.actors, which the other fields refer to */
  index: number
  key: string
  name: string | null
  kind: 'member' | 'pet' | 'enemy'
  /** The owner of a pet */
  owner: number | null
  /** Whether it is the main enemy */
  main: boolean
  job: number | null
  role: 'tank' | 'healer' | 'dps' | null
  /** Empty for pets */
  track: Track
}
export interface Hit {
  t: number
  source: number | null
  sourceName: string | null
  /** The Action of a direct hit, the Status of damage over time */
  actionId: number | null
  name: string | null
  amount: number
  periodic: boolean
}
export interface StatusNote {
  statusId: number
  name: string | null
  since: number
}
export type ReplayEvent =
  | {
      kind: 'death'
      t: number
      actor: number
      killingBlow: Hit | null
      /** Newest first */
      recentHits: Hit[]
      maxHp: number | null
      statuses: StatusNote[]
    }
  | {
      kind: 'penalty'
      t: number
      actor: number
      statusId: number
      name: string | null
      durationMs: number | null
      stacks: number | null
      cause: { source: number | null; sourceName: string | null; actionId: number | null; name: string | null }
    }
  | { kind: 'bigHit'; t: number; actor: number; hit: Hit; maxHp: number; statuses: StatusNote[] }
  | { kind: 'bossIn' | 'bossDown'; t: number; actor: number }
  | { kind: 'bossOut'; t: number; actor: number; reason: 'untargetable' | 'left' }
  /** One edge of a cutscene that plays from `from` to `to` */
  | { kind: 'cutscene'; t: number; edge: 'start' | 'end'; from: number; to: number }
export interface ReplayCast {
  t: number
  actor: number
  durationMs: number
  actionId: number
  name: string | null
  cancelledAt: number | null
}
export interface ReplayAction {
  actionId: number
  name: string | null
  gcd: boolean
  lane: 'buff' | 'mitigation' | null
  durationMs: number | null
}
export interface ReplayStatus {
  actor: number
  statusId: number
  source: number | null
  from: number
  to: number
  stacks: number | null
}
export interface ReplayStatusInfo {
  statusId: number
  name: string | null
  category: 'buff' | 'debuff' | null
  /** Whether the combat model marks it as the status of a raid buff, as PeriodicDefs.raidBuffStatuses */
  raidBuff: boolean
}
/** A hit the host measured the damage per potency with */
export interface PotencySample {
  /** Review time */
  t: number
  /** Index into actors; only members, pets give no samples */
  actor: number
  /** Index into actors; -1 when the target is not an actor */
  target: number
  actionId: number
  amount: number
  potency: number
  multiplier: number
  critical: boolean
  direct: boolean
  /** source: index into actors, null when the source is not an actor */
  factors: { statusId: number; source: number | null; holder: 'caster' | 'target'; value: number }[]
}
/** One fight as the review shows it; the page sums the entries over the filter and span it is given. */
export interface ReplayData {
  fight: { visitId: string; fightId: string; durationMs: number }
  actors: ReplayActor[]
  casts: ReplayCast[]
  uses: Uses
  actions: ReplayAction[]
  entries: Entries
  /** The skill keys the entries refer to, as in Row.skills */
  skills: string[]
  statuses: ReplayStatus[]
  statusInfo: ReplayStatusInfo[]
  /** In time order */
  events: ReplayEvent[]
  /** In time order */
  potency: PotencySample[]
}
export type ReplayResult = { ok: true; data: ReplayData } | { ok: false; reason: string }

/** The Action or Status a skill key names: `action:<Action ID>` or `status:<Status ID>` */
export function skillId(key: string): { kind: 'action' | 'status'; id: number } | null {
  const match = /^(action|status):(\d+)$/.exec(key)
  return match ? { kind: match[1] as 'action' | 'status', id: Number(match[2]) } : null
}
