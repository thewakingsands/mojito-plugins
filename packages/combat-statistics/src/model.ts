import type { SourceMeta } from '@ffcafe/mojito-plugin-sdk'

export type Quality = 'observed' | 'estimated' | 'partial' | 'unavailable'
export interface Metric {
  value: number | null
  quality: Quality
  reason?: string
}
export const metric = (value: number | null, quality: Quality = 'observed', reason?: string): Metric =>
  value === null
    ? { value, quality: 'unavailable', reason: reason ?? '没有可用输入或时长为零' }
    : { value, quality, ...(reason ? { reason } : {}) }
export const sourceKey = (meta: SourceMeta) => `${meta.sessionId}:${meta.characterGeneration}:${meta.clockGeneration}`
export interface Actor {
  key: string
  id: number
  name: string | null
  worldId: number | null
  job: number | null
  kind: 'member' | 'pet' | 'enemy' | 'unknown'
  ownerKey: string | null
}
export type Scope = 'party' | 'alliance' | 'all'
export interface Settings {
  mode: 'auto' | 'manual'
  quietSeconds: number
  mergePets: boolean
  scope: Scope
}
export const defaults: Settings = { mode: 'auto', quietSeconds: 10, mergePets: true, scope: 'party' }
export function settings(value: unknown): Settings {
  if (!value || typeof value !== 'object') throw new Error('无效分场设置')
  const input = value as Settings
  if (
    !['auto', 'manual'].includes(input.mode) ||
    !Number.isInteger(input.quietSeconds) ||
    input.quietSeconds < 3 ||
    input.quietSeconds > 120 ||
    typeof input.mergePets !== 'boolean'
  )
    throw new Error('静默时间必须为 3–120 秒')
  // Settings saved before the scope option existed keep the original own-party behavior.
  const scope = input.scope ?? 'party'
  if (!['party', 'alliance', 'all'].includes(scope)) throw new Error('无效解析范围')
  return { mode: input.mode, quietSeconds: input.quietSeconds, mergePets: input.mergePets, scope }
}
export interface Amounts {
  damage: number
  healing: number
  taken: number
  healingTaken: number
  swings: number
  hits: number
  misses: number
  immune: number
  crit: number
  direct: number
  critDirect: number
  deaths: number
  petDeaths: number
  /** The part of healing beyond the HP the target missed before it landed */
  overhealed: number
  /** Healing that landed without a known target HP; it counts as effective healing */
  unmeasuredHealing: number
}
export const amounts = (): Amounts => ({
  damage: 0,
  healing: 0,
  taken: 0,
  healingTaken: 0,
  swings: 0,
  hits: 0,
  misses: 0,
  immune: 0,
  crit: 0,
  direct: 0,
  critDirect: 0,
  deaths: 0,
  petDeaths: 0,
  overhealed: 0,
  unmeasuredHealing: 0,
})
export interface SkillAmounts {
  damage: number
  healing: number
  hits: number
  /** Direct damage hits, the denominator of the critical and direct-hit rates of the skill */
  directHits: number
  crit: number
  direct: number
  critDirect: number
  overhealed: number
  unmeasuredHealing: number
  /** D − R − U + G of the skill; absent in summaries saved before rDPS */
  contribution?: number
}
export const skillAmounts = (): SkillAmounts => ({
  damage: 0,
  healing: 0,
  hits: 0,
  directHits: 0,
  crit: 0,
  direct: 0,
  critDirect: 0,
  overhealed: 0,
  unmeasuredHealing: 0,
  contribution: 0,
})
/** The skill key of damage reflected onto the enemy that caused it; it names no Action or Status */
export const REFLECT_SKILL = 'reflect'
export interface Maximum {
  actionId: number
  actorKey: string
  amount: number
}
export interface Row {
  actor: Actor
  firstAt: number
  lastAt: number
  hasSettlementTime?: boolean
  totals: Amounts
  estimatedDamage: number
  estimatedHealing: number
  maxHit: Maximum | null
  maxHeal: Maximum | null
  skills: Record<string, SkillAmounts>
  targets: Record<string, { damage: number; healing: number }>
  /** D − R − U + G of the actor; absent in summaries saved before rDPS */
  contribution?: number
}
export interface RowSummary extends Omit<Row, 'skills'> {
  skills: Record<string, SkillAmounts & { overheal: Metric; contributionDps: Metric }>
  metrics: Record<string, Metric>
}
export interface Summary {
  schemaVersion: 1
  title?: string | null
  /** Packet elapsed time, independent of the source clock used for lifecycle deadlines. */
  durationMs?: number
  id: string
  source: string
  zone: number | null
  startAt: number
  endAt: number
  lastHostileAt: number
  ended: boolean
  reason: string | null
  quality: string[]
  diagnostics: {
    unassignedObservedDamage: number
    outOfScopeDamage: number
    observedTargetDamage: number
    unknownEffects: number
    invalidRevisions: number
    unknownActors: number
    /** Splits of the host that matched no damage of the encounter */
    unmatchedAttributions: number
    /** What the damage of the encounter gave to the statuses of players outside the scope */
    outOfScopeContribution: number
  }
  rows: RowSummary[]
  encounterDamage: Metric
  reportedHealing: Metric
  /** Why contributionDps is unavailable for the encounter; null when it is available, absent before rDPS */
  contributionUnavailable?: string | null
  outcome: FightOutcome
}
export type FightResult = 'kill' | 'wipe' | 'ended'
export interface FightOutcome {
  /** null while the fight runs */
  result: FightResult | null
  mainEnemy: {
    key: string
    name: string | null
    hpCur: number | null
    hpMax: number | null
    hpPercent: number | null
  } | null
}
