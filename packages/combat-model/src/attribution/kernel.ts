import type { DamageContribution } from '../events.js'

/**
 * Whose modifier it is, from the attacker: the attacker, or another player whose modifier is not a raid buff; another
 * player, for a raid buff of theirs; or a source that is not a player
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
  unattributed: number
}

const DIRECT_MULTIPLIER = 1.25

/**
 * A factor of the split, and the effects its part goes to by their weights; the part of a factor without effects
 * stays with the attacker
 */
interface Factor {
  value: number
  effects: readonly AttributionEffect[]
  weights: readonly number[]
}

/** The critical or the direct hit rate modifiers, from the attacker */
interface RateGroup {
  /** The rate the modifiers of the attacker add */
  own: number
  /** The modifiers of the others, and the share of each in what they add */
  external: AttributionEffect[]
  weights: number[]
  /** The rate with the modifiers of the attacker, and with all modifiers; at most 1 */
  unbuffed: number
  buffed: number
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0)

function rateGroup(effects: readonly AttributionEffect[], type: 'critical' | 'direct', natural: number): RateGroup {
  const own = sum(effects.filter((item) => item.type === type && item.owner === 'self').map((item) => item.value))
  const external = effects.filter((item) => item.type === type && item.owner !== 'self' && item.value > 0)
  const added = sum(external.map((item) => item.value))
  // Past the cap, the others share what is left of the rate as they would share what they add
  return {
    own,
    external,
    weights: external.map((item) => item.value / added),
    unbuffed: Math.min(1, natural + own),
    buffed: Math.min(1, natural + own + added),
  }
}

/** A factor of the others in a rate group */
const groupFactor = (group: RateGroup, value: number): Factor => ({
  value,
  effects: group.external,
  weights: group.weights,
})
const ownFactor = (value: number): Factor => ({ value, effects: [], weights: [] })

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
    const own = 1 + gain * group.own
    const all = 1 + gain * (group.own + sum(group.external.map((item) => item.value)))
    return [{ weight: 1, factors: [ownFactor(own), groupFactor(group, all / own)] }]
  }
  if (!happened || group.buffed === 0) return [{ weight: 1, factors: [] }]
  // The chance that the others made it happen
  const chance = (group.buffed - group.unbuffed) / group.buffed
  return [
    { weight: chance, factors: [groupFactor(group, multiplier)] },
    { weight: 1 - chance, factors: [] },
  ].filter((way) => way.weight > 0)
}

/** The factors of the expected damage of a rate group, against the natural rate */
function expectedFactors(group: RateGroup, natural: number, multiplier: number): Factor[] {
  const gain = multiplier - 1
  const expected = (rate: number) => 1 + rate * gain
  return [
    ownFactor(expected(group.unbuffed) / expected(natural)),
    groupFactor(group, expected(group.buffed) / expected(group.unbuffed)),
  ]
}

/** The part of the bonus of amount each factor gives: the bonus split by the logarithms of the factors */
function logShares(amount: number, factors: readonly Factor[]): number[] {
  const logs = factors.map((factor) => (factor.value > 1 ? Math.log(factor.value) : 0))
  const total = sum(logs)
  if (total === 0) return logs
  const bonus = amount * (1 - Math.exp(-total))
  return logs.map((log) => (bonus * log) / total)
}

/** Splits a damage among the attacker and the modifiers of the others, as design.md describes */
export function attribute(input: AttributionInput): AttributionResult {
  const { amount, effects, rates, outcome } = input
  const multipliers: Factor[] = effects
    .filter((item) => item.type === 'multiplier' && item.value > 1)
    .map((item) =>
      item.owner === 'self' ? ownFactor(item.value) : { value: item.value, effects: [item], weights: [1] },
    )
  const critical = rateGroup(effects, 'critical', rates.critical)
  const direct = rateGroup(effects, 'direct', rates.direct)

  let ways: { weight: number; factors: Factor[] }[]
  if (outcome.type === 'expected') {
    ways = [
      {
        weight: 1,
        factors: [
          ...expectedFactors(critical, rates.critical, rates.criticalMultiplier),
          ...expectedFactors(direct, rates.direct, DIRECT_MULTIPLIER),
        ],
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
  let unattributed = 0
  for (const [effect, part] of parts) {
    if (part === 0) continue
    if (effect.owner === 'other') {
      unattributed += part
      continue
    }
    const key = `${effect.sourceId}:${effect.statusId}`
    const contribution = contributions.get(key)
    if (contribution) contribution.amount += part
    else contributions.set(key, { statusId: effect.statusId, sourceId: effect.sourceId, amount: part })
  }
  const sorted = [...contributions.values()].sort((a, b) => a.sourceId - b.sourceId || a.statusId - b.statusId)
  return {
    retained: amount - sum(sorted.map((item) => item.amount)) - unattributed,
    contributions: sorted,
    unattributed,
  }
}
