/**
 * The results of the estimator and the attributor as the engine handles them. They hold more than the outputs: the
 * snapshots and rates of the shares, which the attributor reads, and the time of the input that gave them.
 */
export interface BaseEvent {
  eventType: string
  eventTime: number
}

/** A tick of an over time effect, with the part each status and its source had in it */
export interface PeriodicTickEvent extends BaseEvent {
  eventType: 'PeriodicTickEvent'

  /** Counts the ticks the engine handled, from 1; a revision names the ticks by it */
  tickId: number
  /** 'realtime' when the tick arrived, 'post' inside a PeriodicRevisionEvent */
  phase: 'realtime' | 'post'
  /** Who the tick hits */
  combatant: number
  isHeal: boolean
  /** statusId of the packet, 0 for a tick that sums the statuses of the combatant */
  statusId: number
  /** The value of the packet */
  total: number
  /** The sum the estimator expected before the tick, from the statuses it knew; null when it could not tell */
  prediction: number | null
  /** A status list of the combatant came with the tick and named every status in it */
  confirmed: boolean
  /** The part of total given to nobody: total when shares is empty, 0 otherwise */
  unknown: number
  shares: PeriodicShare[]
}

export interface PeriodicShare {
  statusId: number
  /** Who applied the status: from the status list for a summed tick, from the packet otherwise */
  sourceId: number
  /** An integer; the amounts of the shares add up to total */
  amount: number
  /**
   * exact: the only status of a confirmed tick, or a tick of its own status
   * sourceExact: one of several statuses of a confirmed tick that came from one source; the sum of the source is exact
   * estimated: a confirmed tick with statuses of several sources
   * unconfirmed: the statuses the estimator knew on the combatant, without a status list to confirm them
   */
  basis: 'exact' | 'sourceExact' | 'estimated' | 'unconfirmed'
  /**
   * The modifiers the status took when it was applied. For a damage tick of its own status, those its application
   * took, empty without an application; empty for a heal tick of its own status.
   */
  snapshot: SnapshotModifier[]
  /**
   * The critical and direct hit rates of the source without modifiers and the critical multiplier, as the estimator
   * used them; null for a heal tick of its own status
   */
  rates: { critical: number; direct: number; criticalMultiplier: number } | null
}

export interface SnapshotModifier {
  /** The status with the modifier; 0 for a modifier of the gauge */
  statusId: number
  /** Who gave that status */
  sourceId: number
  holder: 'caster' | 'target'
  /** multiplier: the factor; critical, direct: the rate it adds */
  type: 'multiplier' | 'critical' | 'direct'
  value: number
}

/** The ticks of a battle that ended, split again with what the whole battle showed */
export interface PeriodicRevisionEvent extends BaseEvent {
  eventType: 'PeriodicRevisionEvent'

  /** Every summed tick of the battle, in the order they came; each replaces the PeriodicTickEvent of its tickId */
  ticks: PeriodicTickEvent[]
}

/**
 * A hit that the estimator took as a sample of the damage per potency: a damage hit on the first target, of an action
 * of the job of the caster whose potency the bonus percentage of the hit tells, not forced and without a status that
 * adds potency
 */
export interface PotencySampleEvent extends BaseEvent {
  eventType: 'PotencySampleEvent'

  caster: number
  target: number
  action: number
  /** The global sequence of the AbilityEffect */
  sequence: number
  amount: number
  /** The potency at the level of the caster, in a combo or from a side as the hit was, times the potency modifiers of the gauge */
  potency: number
  /** The product of the damage multipliers of the statuses in the periodic data */
  multiplier: number
  /** The multiplier entries of ModifierResult.effects */
  factors: PotencyFactor[]
  critical: boolean
  direct: boolean
}

export interface PotencyFactor {
  /** 0 for a modifier of the gauge */
  statusId: number
  sourceId: number
  holder: 'caster' | 'target'
  value: number
}

/** A damage of a player, split into what stays with the player and what the modifiers of others gave */
export interface DamageAttributionEvent extends BaseEvent {
  eventType: 'DamageAttributionEvent'

  /** Counts the splits of the attributor, from 1; an AttributionDeltaEvent names the split by it */
  id: number

  /** The player the damage counts for: who dealt it, or the owner of the pet that dealt it */
  attacker: number
  /** Who dealt it: the attacker or a pet of the attacker */
  actor: number
  target: number
  origin: { type: 'action'; action: number; sequence: number } | { type: 'tick'; tickId: number; statusId: number }
  amount: number
  /** amount without the contributions */
  retained: number
  /** One for each status and source that is another player; sorted by sourceId, then statusId */
  contributions: DamageContribution[]
}

export interface DamageContribution {
  statusId: number
  /** The player who gave the status; the owner when a pet gave it */
  sourceId: number
  amount: number
}

/** How the split of the damage of a window changed when the window closed: the split after it minus the realtime one */
export interface AttributionDeltaEvent extends BaseEvent {
  eventType: 'AttributionDeltaEvent'

  records: AttributionDelta[]
}

export interface AttributionDelta {
  /** The id of the realtime DamageAttributionEvent; null for a share of a summed tick */
  id: number | null
  /** The tickId of the summed tick; null otherwise */
  tickId: number | null
  attacker: number
  actor: number
  origin: { type: 'action'; action: number } | { type: 'tick'; statusId: number }
  /**
   * The change of each status and source; a part only the realtime split had is its realtime amount negated, a part
   * only the split after the window has is its amount. Sorted by sourceId, then statusId.
   */
  contributions: DamageContribution[]
}
