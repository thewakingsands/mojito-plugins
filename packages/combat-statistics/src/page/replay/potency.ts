import { analyzePotency as analyze, type PotencyAnalysis } from '@ffcafe/mojito-combat-model/analysis'
import type { ReplayData } from '../../view-model.js'
import { statusName } from './parts.js'

export {
  GAP_MS,
  type PotencyAnalysis,
  type PotencyPoint,
  type PotencyRegion,
} from '@ffcafe/mojito-combat-model/analysis'

/** The damage per potency of a member in the fight */
export function analyzePotency(data: ReplayData, actor: number): PotencyAnalysis | null {
  const samples = data.potency
    .filter((sample) => sample.actor === actor)
    .map(({ t, target, actionId, amount, potency, multiplier, factors, critical, direct }) => ({
      t,
      targetId: target >= 0 ? target : null,
      actionId,
      amount,
      potency,
      multiplier,
      critical,
      direct,
      factors: factors.map(({ statusId, source, holder, value }) => ({ statusId, sourceId: source, holder, value })),
    }))
  // The review marks the raid buffs, so that the page need not load the data of the combat model
  const raidBuffStatuses = new Set(data.statusInfo.filter((info) => info.raidBuff).map((info) => info.statusId))
  return analyze(samples, {
    actor,
    durationMs: data.fight.durationMs,
    statuses: data.statuses,
    raidBuffStatuses,
  })
}

/** The statuses on the actor at t, in the order they began; of those with the same name only the earliest */
export function statusesAt(data: ReplayData, actor: number, t: number): { statusId: number; name: string }[] {
  const seen = new Set<string>()
  const result: { statusId: number; name: string }[] = []
  const active = data.statuses
    .filter((status) => status.actor === actor && status.from <= t && t < status.to)
    .sort((a, b) => a.from - b.from)
  for (const { statusId } of active) {
    const name = statusName(data, statusId)
    if (seen.has(name)) continue
    seen.add(name)
    result.push({ statusId, name })
  }
  return result
}
