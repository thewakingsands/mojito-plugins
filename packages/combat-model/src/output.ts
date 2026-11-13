import type { TelemetrySample } from './telemetry.js'

/** The results of CombatEngine. Actor ids are null for no actor, as in the inputs. */

export interface PeriodicTick {
  /** Counts the ticks the engine handled, from 1; a revision names the ticks by it */
  tickId: number
  /** The time of the tick input */
  occurredAt: number
  target: number | null
  isHeal: boolean
  /** The status of the tick input, 0 for a tick that sums the statuses of the target */
  statusId: number
  total: number
  /** The part of total given to nobody: total when shares is empty, 0 otherwise */
  unknown: number
  /** A status list of the target came with the tick and named every status in it */
  confirmed: boolean
  /** 'realtime' when the tick arrived, 'post' inside a revision */
  phase: 'realtime' | 'post'
  shares: PeriodicShare[]
}

export interface PeriodicShare {
  /** Who applied the status */
  sourceId: number | null
  statusId: number
  /** An integer; the amounts of the shares add up to total */
  amount: number
  /**
   * exact: the only status of a confirmed tick, or a tick of its own status
   * sourceExact: one of several statuses of a confirmed tick that came from one source; the sum of the source is exact
   * estimated: a confirmed tick with statuses of several sources
   * unconfirmed: the statuses known on the target, without a status list to confirm them
   */
  basis: 'exact' | 'sourceExact' | 'estimated' | 'unconfirmed'
}

/** A damage hit of an action with a known potency, as a sample of the damage per potency */
export interface PotencySample {
  casterId: number | null
  targetId: number | null
  actionId: number
  sequence: number
  amount: number
  /** The potency at the level of the caster, in a combo or from a side as the hit was, times the potency modifiers of the gauge */
  potency: number
  /** The product of the damage multipliers of the statuses in the data */
  multiplier: number
  /** statusId 0 is a modifier of the gauge */
  factors: { statusId: number; sourceId: number | null; holder: 'caster' | 'target'; value: number }[]
  critical: boolean
  direct: boolean
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
  /** Counts the splits from 1; attributionRevision refers to it */
  id: number
  origin: { type: 'action'; actionId: number; sequence: number } | { type: 'tick'; tickId: number; statusId: number }
  /** The player the damage counts for: who dealt it, or the owner of the pet that dealt it */
  attackerId: number | null
  /** Who dealt it: the attacker or a pet of the attacker */
  actorId: number | null
  targetId: number | null
  amount: number
  /** amount without the contributions */
  retained: number
  /** Sorted by sourceId, then statusId; never the attacker */
  contributions: AttributionPart[]
}

/** How the split of one damage changed when its window closed: the result after the window minus the realtime one */
export interface AttributionDelta {
  /** The id of the realtime split; null for a share of a summed tick */
  id: number | null
  /** The tickId of the summed tick; null otherwise */
  tickId: number | null
  actorId: number | null
  origin: { type: 'action'; actionId: number } | { type: 'tick'; statusId: number }
  /** amount is the change; a part only one of the two splits has is included */
  contributions: AttributionPart[]
}

export type CombatOutput =
  | { type: 'telemetrySample'; data: TelemetrySample }
  | { type: 'periodicTick'; data: PeriodicTick }
  | { type: 'periodicRevision'; data: { ticks: PeriodicTick[] } }
  | { type: 'potencySample'; data: PotencySample }
  | { type: 'damageAttributed'; data: DamageAttribution }
  | { type: 'attributionRevision'; data: { records: AttributionDelta[] } }
