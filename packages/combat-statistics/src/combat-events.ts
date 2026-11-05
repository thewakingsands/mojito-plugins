import type {
  AttributionDelta,
  AttributionPart,
  DamageAttribution as ModelAttribution,
  PeriodicTick as ModelTick,
} from '@ffcafe/mojito-combat-model'
import type { GameEventMap as HostEventMap, GameEvent as HostGameEvent } from '@ffcafe/mojito-plugin-sdk'

export type { AttributionDelta, AttributionPart }

/**
 * The results of the combat model as the plugin hands them on, with the shapes Plugin API 1.8.0 gave them: the log,
 * the ledger and the review read them, and the log keeps them. estimatorGeneration numbers the engine of the data
 * source that gave them.
 */
export type PeriodicTick = ModelTick & { estimatorGeneration: number }
export type DamageAttribution = ModelAttribution & { estimatorGeneration: number }

export interface CombatResultMap {
  periodicTick: PeriodicTick
  periodicRevision: { estimatorGeneration: number; ticks: PeriodicTick[] }
  damageAttributed: DamageAttribution
  /** A hit of an action with a known potency, as the model measured its damage per potency */
  potencySample: {
    casterId: number | null
    targetId: number | null
    actionId: number
    /** The global sequence of the actionEffect it came from */
    sequence: number
    amount: number
    /** The potency at the level of the caster, in a combo or from a side as the hit was, times the potency modifiers of the gauge */
    potency: number
    /** The product of the damage multipliers of the statuses the model knows */
    multiplier: number
    factors: { statusId: number; sourceId: number | null; holder: 'caster' | 'target'; value: number }[]
    /** Logs written with hosts older than Plugin API 1.8.0 lack it, and their samples are not critical */
    critical?: boolean
    /** Logs written with hosts older than Plugin API 1.8.0 lack it, and their samples are not direct */
    direct?: boolean
  }
  attributionRevision: { estimatorGeneration: number; records: AttributionDelta[] }
}

export type GameEventMap = HostEventMap & CombatResultMap

/** The packet a result came with: that of the input it came from; the revisions have none */
export interface ResultPacket {
  seq: number
  timestamp: number
  sourceActorId: number
  targetActorId: number
}

export type CombatResultEvent<T extends keyof CombatResultMap = keyof CombatResultMap> = {
  [K in T]: { type: K; data: CombatResultMap[K]; packet?: ResultPacket }
}[T]

/** The events of the host and the results of the combat model; narrowing type also narrows data */
export type GameEvent<T extends keyof GameEventMap = keyof GameEventMap> = T extends keyof CombatResultMap
  ? CombatResultEvent<T>
  : T extends keyof HostEventMap
    ? HostGameEvent<T>
    : never
