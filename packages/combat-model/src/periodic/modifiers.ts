import { invalidTarget } from '../constants.js'
import {
  type ActionCategory,
  type AttackType,
  type DamageType,
  type PeriodicDefs,
  type PeriodicKind,
  type StatusModifier,
  valueAt,
} from '../defs.js'
import type { SnapshotModifier } from '../events.js'
import type { CombatWorld, WorldStatus } from '../world.js'
import type { ElementTracker } from './elements.js'

/** The auto attacks, which forced results and potency bonuses without actions leave out */
const AUTO_ATTACKS: ReadonlySet<number> = new Set([7, 8])
const PHYSICAL: ReadonlySet<AttackType> = new Set(['slashing', 'piercing', 'blunt', 'shot', 'physical'])
const HEALED_BY_MULTIPLIERS: ReadonlySet<ActionCategory> = new Set(['spell', 'ability'])

/** What an action is, as far as the conditions of the modifiers read it */
export interface ActionInfo {
  id: number
  /** null for an action the data does not describe */
  category: ActionCategory | null
  attackType: AttackType | null
}

export interface ModifierQuery {
  kind: PeriodicKind
  caster: number
  target: number
  action: ActionInfo
  /**
   * The player whose pet the caster is. The game gives a pet the statuses other players put on its owner, but the
   * client seldom sees them on the pet.
   */
  owner?: number
}

/** A modifier that took part: the factor of a multiplier, or the rate a critical or direct hit modifier adds */
export type SnapshotEffect = SnapshotModifier

/** Which statuses a computation reads: those of the caster, those of the target, or both */
export type ModifierSide = 'all' | 'caster' | 'target'

export interface ModifierResult {
  /** M, the product of the multipliers */
  multiplier: number
  /** Whether every potentially applicable rule had the data it needed; does not change calculation. */
  telemetryComplete: boolean
  /** Δc, damage only */
  critRate: number
  /** Δd, damage only */
  directRate: number
  forcedCritical: boolean
  forcedDirect: boolean
  /** A status of the caster adds potency that no factor gives; the potency of the action is not known */
  potencyBonus: boolean
  /** The product of the potency modifiers of the gauge */
  potencyFactor: number
  effects: SnapshotEffect[]
}

const matchesDamageType = (type: DamageType, attackType: AttackType | null) =>
  attackType !== null && (type === 'physical' ? PHYSICAL.has(attackType) : attackType === type)

/** The modifiers of the statuses and the gauges at one moment */
export class ModifierCalculator {
  /** The territory of the last ChangeZoneEvent; null before the first */
  zone: number | null = null

  /**
   * @param applyByteOf The signed byte 1 of the entry that applied the status, as the estimator recorded it
   */
  constructor(
    private defs: PeriodicDefs,
    private combatants: CombatWorld,
    private elements: ElementTracker,
    private applyByteOf: (holder: number, source: number, status: number) => number | null,
  ) {}

  /** @param side The forced results, and the modifiers of the gauge, come with the caster */
  compute(query: ModifierQuery, side: ModifierSide = 'all'): ModifierResult {
    const result: ModifierResult = {
      multiplier: 1,
      telemetryComplete: true,
      critRate: 0,
      directRate: 0,
      forcedCritical: false,
      forcedDirect: false,
      potencyBonus: false,
      potencyFactor: 1,
      effects: [],
    }
    if (side !== 'target') {
      const forced = this.defs.forced.get(query.action.id)
      if (forced === 'critical' || forced === 'criticalDirect') result.forcedCritical = true
      if (forced === 'direct' || forced === 'criticalDirect') result.forcedDirect = true
      // The owner's own statuses stay with the owner: not all of them reach the pet
      const inherited = new Set<string>()
      if (query.owner !== undefined && query.owner !== query.caster) {
        for (const buff of this.combatants.getBuffs(query.owner)) {
          if (buff.source === query.owner) continue
          this.applyStatus(result, query, buff, query.owner, 'caster')
          inherited.add(`${buff.id}:${buff.source}`)
        }
      }
      for (const buff of this.combatants.getBuffs(query.caster)) {
        if (inherited.has(`${buff.id}:${buff.source}`)) continue
        this.applyStatus(result, query, buff, query.caster, 'caster')
      }
    }
    if (side !== 'caster' && query.target !== query.caster) {
      for (const buff of this.combatants.getBuffs(query.target)) {
        this.applyStatus(result, query, buff, query.target, 'target')
      }
    }
    if (side !== 'target') this.applyGauge(result, query)
    return result
  }

  private applyStatus(
    result: ModifierResult,
    query: ModifierQuery,
    buff: WorldStatus,
    holderId: number,
    holder: 'caster' | 'target',
  ): void {
    for (const modifier of this.defs.modifiers.get(buff.id) ?? []) {
      const applies = this.applies(modifier, query, buff, holder)
      if (applies === undefined) result.telemetryComplete = false
      if (!applies) continue
      switch (modifier.type) {
        case 'forceCritical':
          result.forcedCritical = true
          continue
        case 'forceDirect':
          result.forcedDirect = true
          continue
        case 'potencyBonus':
          result.potencyBonus = true
          continue
      }

      const value = this.valueOf(modifier, buff, holderId)
      if (value === null) {
        result.telemetryComplete = false
        continue
      }
      if (
        'value' in modifier &&
        modifier.value.some((entry) => entry.value !== modifier.value[0].value) &&
        !this.combatants.get(buff.source).level
      )
        result.telemetryComplete = false
      const effect = { statusId: buff.id, sourceId: buff.source, holder }
      switch (modifier.type) {
        case 'critRate':
        case 'critRateTaken':
          result.critRate += value
          result.effects.push({ ...effect, type: 'critical', value })
          break
        case 'directHitRate':
          result.directRate += value
          result.effects.push({ ...effect, type: 'direct', value })
          break
        default:
          result.multiplier *= 1 + value
          result.effects.push({ ...effect, type: 'multiplier', value: 1 + value })
      }
    }
  }

  /** Whether the modifier of the status counts for the query, by where it is and its conditions */
  private applies(
    modifier: StatusModifier,
    query: ModifierQuery,
    buff: WorldStatus,
    holder: 'caster' | 'target',
  ): boolean | undefined {
    let unknown = false
    const { type } = modifier
    const onTarget = type === 'damageTaken' || type === 'healingReceived' || type === 'critRateTaken'
    if (onTarget !== (holder === 'target')) return false
    if ('scope' in modifier && modifier.scope === 'source' && buff.source !== query.caster) {
      if (buff.source === 0 || buff.source === invalidTarget) unknown = true
      else return false
    }

    const damage = query.kind === 'damage'
    if ((type === 'damageDealt' || type === 'damageTaken') && !damage) return false
    if ((type === 'healingDealt' || type === 'healingReceived') && damage) return false
    if ((type === 'critRate' || type === 'critRateTaken' || type === 'directHitRate') && !damage) return false

    if (modifier.zones) {
      if (this.zone === null) unknown = true
      else if (!modifier.zones.includes(this.zone)) return false
    }
    const action = query.action.id
    if (modifier.actions) {
      if (!modifier.actions.includes(action)) return false
    } else if (
      (type === 'forceCritical' || type === 'forceDirect' || type === 'potencyBonus') &&
      AUTO_ATTACKS.has(action)
    ) {
      return false
    }

    if ('category' in modifier && modifier.category) {
      if (query.action.category === null) unknown = true
      else if (modifier.category !== query.action.category) return false
    }
    if ('damageType' in modifier && modifier.damageType) {
      if (query.action.attackType === null) unknown = true
      else if (!matchesDamageType(modifier.damageType, query.action.attackType)) return false
    }
    if (type === 'healingDealt' || type === 'healingReceived') {
      const category = query.action.category
      if (category === null) unknown = true
      else if (!HEALED_BY_MULTIPLIERS.has(category)) return false
    }
    return unknown ? undefined : true
  }

  /** @returns The value of the modifier, with the stacks; null for a byte that was not recorded */
  private valueOf(modifier: StatusModifier, buff: WorldStatus, holderId: number): number | null {
    let value: number
    if ('valueFrom' in modifier) {
      const byte = this.applyByteOf(holderId, buff.source, buff.id)
      if (byte === null) return null
      value = byte / 100
    } else if ('value' in modifier) {
      value = valueAt(modifier.value, this.combatants.get(buff.source).level ?? 0)
    } else {
      return null
    }
    if ('stacked' in modifier && modifier.stacked) value *= buff.stacks
    return value
  }

  private applyGauge(result: ModifierResult, query: ModifierQuery): void {
    const state = this.elements.stateOf(query.caster)
    if (!state) {
      if (this.elements.hasElements(query.caster)) result.telemetryComplete = false
      return
    }
    const level = this.combatants.get(query.caster).level ?? 0
    for (const modifier of this.defs.gauge) {
      if (modifier.type === 'damageDealt' && query.kind !== 'damage') continue
      if (modifier.actions && !modifier.actions.includes(query.action.id)) continue
      if (modifier.category && modifier.category !== query.action.category) continue
      if (modifier.damageType && !matchesDamageType(modifier.damageType, query.action.attackType)) continue
      if (!modifier.when(state)) continue
      const value = valueAt(modifier.value, level)
      if (modifier.type === 'potency') {
        result.potencyFactor *= 1 + value
      } else {
        result.multiplier *= 1 + value
        result.effects.push({
          statusId: 0,
          sourceId: query.caster,
          holder: 'caster',
          type: 'multiplier',
          value: 1 + value,
        })
      }
    }
  }
}
