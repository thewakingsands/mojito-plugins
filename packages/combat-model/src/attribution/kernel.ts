import type { DamageContribution } from '../events.js'

/**
 * Whose modifier it is, from the attacker: the attacker, or another player whose modifier is not a raid buff; another
 * player, for a raid buff of theirs; or a source that is not a player. The modifiers of self and other are conditions
 * of the damage and stay with the attacker; only those of player are split.
 */
export type EffectOwner = 'self' | 'player' | 'other'

export interface AttributionEffect {
  statusId: number
  /** The player who gave it for self and player */
  sourceId: number
  owner: EffectOwner
  /** multiplier: value is the factor; critical, direct: value is the rate it adds */
  type: 'multiplier' | 'critical' | 'direct'
  value: number
}

/** hit: a damage whose critical and direct hit flags are known; expected: a tick, which has none */
export type AttributionOutcome =
  | { type: 'hit'; critical: boolean; direct: boolean; forcedCritical: boolean; forcedDirect: boolean }
  | { type: 'expected' }

export interface AttributionInput {
  amount: number
  effects: readonly AttributionEffect[]
  /** The natural rates of the attacker and K */
  rates: { critical: number; direct: number; criticalMultiplier: number }
  outcome: AttributionOutcome
}

export interface AttributionResult {
  retained: number
  contributions: DamageContribution[]
}

const DIRECT_MULTIPLIER = 1.25

/** A factor of the split, and the effects its part goes to by their weights */
interface Factor {
  value: number
  effects: readonly AttributionEffect[]
  weights: readonly number[]
}

/** The critical or the direct hit rate modifiers, from the attacker */
interface RateGroup {
  /** The rate the modifiers of self and other add; below 0 for a rate down */
  own: number
  /** The raid buffs, and the share of each in what they add */
  external: AttributionEffect[]
  weights: number[]
  /** The rate without the raid buffs, and with them; from 0 to 1 */
  unbuffed: number
  buffed: number
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0)
const clamp = (rate: number) => Math.min(1, Math.max(0, rate))

function rateGroup(effects: readonly AttributionEffect[], type: 'critical' | 'direct', natural: number): RateGroup {
  const own = sum(effects.filter((item) => item.type === type && item.owner !== 'player').map((item) => item.value))
  const external = effects.filter((item) => item.type === type && item.owner === 'player' && item.value > 0)
  const added = sum(external.map((item) => item.value))
  // Past the cap, the raid buffs share what is left of the rate as they would share what they add
  return {
    own,
    external,
    weights: external.map((item) => item.value / added),
    unbuffed: clamp(natural + own),
    buffed: clamp(natural + own + added),
  }
}

/** A factor of the raid buffs in a rate group */
const groupFactor = (group: RateGroup, value: number): Factor => ({
  value,
  effects: group.external,
  weights: group.weights,
})

/** The factors of a rate group for each way the hit may have come about, with the weight of the way */
function hitWays(
  group: RateGroup,
  happened: boolean,
  forced: boolean,
  multiplier: number,
): { weight: number; factors: Factor[] }[] {
  const gain = multiplier - 1
  if (forced) {
    // A forced result turns the rates into a multiplier of the damage
    const own = Math.max(0, group.own)
    const added = sum(group.external.map((item) => item.value))
    return [{ weight: 1, factors: [groupFactor(group, (1 + gain * (own + added)) / (1 + gain * own))] }]
  }
  if (!happened || group.buffed === 0) return [{ weight: 1, factors: [] }]
  // The chance that the raid buffs made it happen
  const chance = (group.buffed - group.unbuffed) / group.buffed
  return [
    { weight: chance, factors: [groupFactor(group, multiplier)] },
    { weight: 1 - chance, factors: [] },
  ].filter((way) => way.weight > 0)
}

/** The factor the raid buffs of a rate group give the expected damage */
function expectedFactor(group: RateGroup, multiplier: number): Factor {
  const expected = (rate: number) => 1 + rate * (multiplier - 1)
  return groupFactor(group, expected(group.buffed) / expected(group.unbuffed))
}

/** The part of the bonus of amount each factor gives: the bonus split by the logarithms of the factors */
function logShares(amount: number, factors: readonly Factor[]): number[] {
  const logs = factors.map((factor) => (factor.value > 1 ? Math.log(factor.value) : 0))
  const total = sum(logs)
  if (total === 0) return logs
  const bonus = amount * (1 - Math.exp(-total))
  return logs.map((log) => (bonus * log) / total)
}

/**
 * Splits a damage between the attacker and the raid buffs of the other players: the raid buffs get what the damage
 * would lose without them, shared among them by the logarithms of their factors, and the rest stays with the attacker;
 * retained and the contributions add up to amount
 */
export function attribute(input: AttributionInput): AttributionResult {
  const { amount, effects, rates, outcome } = input
  const multipliers: Factor[] = effects
    .filter((item) => item.type === 'multiplier' && item.owner === 'player' && item.value > 1)
    .map((item) => ({ value: item.value, effects: [item], weights: [1] }))
  const critical = rateGroup(effects, 'critical', rates.critical)
  const direct = rateGroup(effects, 'direct', rates.direct)

  let ways: { weight: number; factors: Factor[] }[]
  if (outcome.type === 'expected') {
    ways = [
      {
        weight: 1,
        factors: [expectedFactor(critical, rates.criticalMultiplier), expectedFactor(direct, DIRECT_MULTIPLIER)],
      },
    ]
  } else {
    ways = []
    const criticalWays = hitWays(critical, outcome.critical, outcome.forcedCritical, rates.criticalMultiplier)
    const directWays = hitWays(direct, outcome.direct, outcome.forcedDirect, DIRECT_MULTIPLIER)
    for (const a of criticalWays) {
      for (const b of directWays) ways.push({ weight: a.weight * b.weight, factors: [...a.factors, ...b.factors] })
    }
  }

  const parts = new Map<AttributionEffect, number>()
  for (const { weight, factors } of ways) {
    const all = [...multipliers, ...factors]
    logShares(amount, all).forEach((part, index) => {
      const factor = all[index]
      factor.effects.forEach((effect, at) => {
        parts.set(effect, (parts.get(effect) ?? 0) + weight * part * factor.weights[at])
      })
    })
  }

  const contributions = new Map<string, DamageContribution>()
  for (const [effect, part] of parts) {
    if (part === 0) continue
    const key = `${effect.sourceId}:${effect.statusId}`
    const contribution = contributions.get(key)
    if (contribution) contribution.amount += part
    else contributions.set(key, { statusId: effect.statusId, sourceId: effect.sourceId, amount: part })
  }
  const sorted = [...contributions.values()].sort((a, b) => a.sourceId - b.sourceId || a.statusId - b.statusId)
  return { retained: amount - sum(sorted.map((item) => item.amount)), contributions: sorted }
}
