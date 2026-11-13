import type {
  CombatantState,
  GameTopics,
  PlayerState,
  Sample,
  SessionSnapshot,
  TimeBase,
} from '@ffcafe/mojito-plugin-sdk'
import type { GameEvent } from '../combat-events.js'
import type { Hp } from '../hp-tracker.js'
import type { FightResult, Scope, Settings } from '../model.js'

export type LogEvent = GameEvent

export interface SourceRecord {
  sessionId: string | null
  characterGeneration: number
  clockGeneration: number
  source: 'live' | 'replay' | null
  timeBase: TimeBase | null
  state: SessionSnapshot['state']
  actorId: number | null
  dataLanguage: string | null
}
export interface Carry {
  encounters: {
    localActorId: number | null
    inCombat: boolean | null
    combatValue: boolean | null
    /** null stands for -Infinity, which JSON cannot carry. */
    packetSeq: number | null
    combatSeq: number | null
    combatAt: number | null
    /** The last HP of each actor, which the first heals of a visit are measured against. */
    hp?: [number, { last: Hp; previous: Hp | null }][]
  }
  generations: [number, number][]
}
export interface Member {
  actorId: number
  name: string | null
  worldId: number | null
  job: number | null
  jobName: string | null
}
export interface MainEnemy {
  name: string | null
  hpCur: number | null
  hpMax: number | null
  hpPercent: number | null
}
export type VisitEndReason = 'zoneChanged' | 'sourceChanged' | 'stopped'
export type { FightResult } from '../model.js'

export interface FightEntry {
  number: number
  id: string
  startAt: number
  /** null while the fight runs or when the log was cut off. */
  endAt: number | null
  reason: string | null
  scope: Scope
  durationMs: number | null
  deaths: number | null
  result: FightResult | null
  mainEnemy: MainEnemy | null
  truncated: boolean
  /** The fightEnd note carries a hash; false without fightEnd or when truncated. */
  hashed: boolean
}
/** Local dates as YYYY-MM-DD, both included; null leaves that end open. */
export interface DateRange {
  from: string | null
  to: string | null
}
export interface VisitEntry {
  id: string
  territoryType: number
  zoneName: string | null
  enteredAt: number
  /** null while the visit runs or when the log was cut off. */
  leftAt: number | null
  /** null while the visit runs. */
  endReason: VisitEndReason | 'interrupted' | null
  current: boolean
  scope: Scope
  members: Member[]
  /** The user's own actorId as the log recorded it; null for logs from before it was recorded, or when it was unknown. */
  self: number | null
  integrity: 'live' | 'unchecked' | 'verified' | 'failed'
  error: string | null
  fights: FightEntry[]
}

export type IdentityOrigin = 'entities' | 'combatants' | 'snapshot'
export type PositionActor = {
  id: number
  x: number
  z: number
  rotation: number
  hpCur: number | null
  hpMax: number | null
}
export type LogRecord =
  | {
      kind: 'visitStart'
      visit: string
      territoryType: number
      zoneName: string | null
      enteredAt: number
      scope: Scope
      members: Member[]
    }
  | { kind: 'source'; value: SourceRecord }
  /** Logs written before the manual mode was removed also have the mode */
  | { kind: 'settings'; value: Settings & { mode?: 'auto' | 'manual' } }
  | { kind: 'carry'; value: Carry }
  | { kind: 'player'; origin: 'watch' | 'get'; value: Partial<PlayerState>; t: number }
  | { kind: 'party'; value: GameTopics['party'] }
  | { kind: 'zone'; value: GameTopics['zone']; t: number }
  | {
      kind: 'identities'
      origin: IdentityOrigin
      entities: (CombatantState & { generation?: number })[]
      missing: number[]
    }
  | { kind: 'event'; sample: Sample<LogEvent> }
  | { kind: 'positions'; t: number; actors: PositionActor[] }
  | { kind: 'fightStart'; fight: number; id: string; startAt: number; scope: Scope }
  | { kind: 'fightEnd'; fight: number; id: string; endAt: number; reason: string }
  | { kind: 'visitEnd'; leftAt: number; reason: VisitEndReason }

export class LogIntegrityError extends Error {}
