import {
  analyzePotency as analyze,
  type PotencyAnalysis as ModelAnalysis,
  type PotencyRegion as ModelRegion,
  type ReasonKind,
} from '@ffcafe/mojito-combat-model/analysis'
import type { ReplayData } from '../../view-model.js'

export { GAP_MS, MIN_WINDOW_SAMPLES, type PotencyPoint, type ReasonKind } from '@ffcafe/mojito-combat-model/analysis'

export interface PotencyRegion extends Omit<ModelRegion, 'known' | 'unknown'> {
  /** In the order raid, self, target, down; only groups that have names */
  known: { kind: ReasonKind; names: string[] }[]
  /** 'partly': known reasons and an unknown remainder; 'unknown': no known reason; null: fully explained */
  unknown: { kind: 'partly' | 'unknown'; self: string[]; boss: string[] | null } | null
}
export interface PotencyAnalysis extends Omit<ModelAnalysis, 'regions'> {
  regions: PotencyRegion[]
}

/** The damage per potency of a member in the fight, with the reasons of its regions as the names of the statuses */
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
  const analysis = analyze(samples, {
    actor,
    durationMs: data.fight.durationMs,
    statuses: data.statuses,
    raidBuffStatuses,
  })
  if (!analysis) return null
  const nameOf = (statusId: number) =>
    data.statusInfo.find((info) => info.statusId === statusId)?.name ?? `状态 #${statusId}`
  // Statuses of the same name count once; status 0 is a modifier of the gauge
  const names = (ids: readonly number[], gauge = false) => [
    ...new Set(ids.map((id) => (gauge && id === 0 ? '量谱' : nameOf(id)))),
  ]
  return {
    ...analysis,
    regions: analysis.regions.map(({ known, unknown, ...region }) => ({
      ...region,
      known: known.map(({ kind, statusIds }) => ({ kind, names: names(statusIds, true) })),
      unknown: unknown && {
        kind: unknown.kind,
        self: names(unknown.self),
        boss: unknown.boss && names(unknown.boss),
      },
    })),
  }
}
