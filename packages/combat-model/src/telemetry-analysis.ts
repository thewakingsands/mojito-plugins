import type { ActionType, AttackType } from './defs.js'
import type { DamageStats, RateStats, TelemetryObservation, TelemetryPayloadBody } from './telemetry.js'

export interface TelemetryEvent {
  eventId: string
  type: 'combat.unknown-status'
  schemaVersion: 1
  producerVersion: string
  payload: TelemetryPayloadBody & {
    modelVersion: string
    dataGameVersion: string
    opcodeVersion: string
    territoryId: number
  }
}
export interface Skipped {
  otherType: number
  otherVersion: number
  invalidPayload: number
  duplicate: number
  otherModelVersion: number
}
const skippedCounts = (): Skipped => ({
  otherType: 0,
  otherVersion: 0,
  invalidPayload: 0,
  duplicate: 0,
  otherModelVersion: 0,
})
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const fields = (value: unknown, keys: string[]): value is Record<string, unknown> =>
  record(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
const nonnegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
const version = (value: unknown): value is string => typeof value === 'string' && /^[\x20-\x7e]{1,64}$/.test(value)
const attackTypes = new Set(['slashing', 'piercing', 'blunt', 'shot', 'physical', 'magic', 'darkness'])
function rate(value: unknown): value is RateStats {
  return (
    fields(value, ['hits', 'successes', 'addedRate']) &&
    integer(value.hits) &&
    integer(value.successes) &&
    value.successes <= value.hits &&
    nonnegative(value.addedRate) &&
    value.addedRate <= value.hits
  )
}
function damage(value: unknown, normal: boolean): value is DamageStats {
  if (!fields(value, normal ? ['count', 'sum', 'sumSquares', 'potencySum'] : ['count', 'sum', 'sumSquares']))
    return false
  if (!integer(value.count) || !nonnegative(value.sum) || !nonnegative(value.sumSquares)) return false
  if (normal && (!nonnegative(value.potencySum) || (value.count > 0 && value.potencySum <= 0))) return false
  return value.count !== 0 || (value.sum === 0 && value.sumSquares === 0 && (!normal || value.potencySum === 0))
}
function statuses(value: unknown): boolean {
  if (!Array.isArray(value) || value.length < 1 || value.length > 60) return false
  let previous = -1
  for (const status of value) {
    if (!fields(status, ['id', 'param']) || !integer(status.id, 1, 65535) || !integer(status.param, 0, 65535))
      return false
    const key = status.id * 65536 + status.param
    if (key <= previous) return false
    previous = key
  }
  return true
}
function payload(value: unknown): value is TelemetryEvent['payload'] {
  if (
    !fields(value, ['modelVersion', 'dataGameVersion', 'opcodeVersion', 'territoryId', 'profiles', 'observations']) ||
    !version(value.modelVersion) ||
    !version(value.dataGameVersion) ||
    !version(value.opcodeVersion) ||
    value.opcodeVersion !== value.modelVersion ||
    !integer(value.territoryId, 1, 4294967295) ||
    !Array.isArray(value.profiles) ||
    value.profiles.length < 1 ||
    value.profiles.length > 256 ||
    !Array.isArray(value.observations) ||
    value.observations.length < 1 ||
    value.observations.length > 1024
  )
    return false
  for (const profile of value.profiles) {
    if (
      !fields(profile, ['classJob', 'level', 'critical', 'direct']) ||
      !integer(profile.classJob, 1, 255) ||
      !integer(profile.level, 1, 255) ||
      !rate(profile.critical) ||
      !rate(profile.direct)
    )
      return false
  }
  const used = new Set<number>()
  for (const observation of value.observations) {
    if (
      !fields(observation, [
        'profile',
        'unknownStatuses',
        'actionId',
        'damageType',
        'normal',
        'baseline',
        'critical',
        'direct',
      ]) ||
      !integer(observation.profile, 0, value.profiles.length - 1) ||
      !statuses(observation.unknownStatuses) ||
      !integer(observation.actionId, 1, 4294967295) ||
      !attackTypes.has(String(observation.damageType)) ||
      !damage(observation.normal, true) ||
      !damage(observation.baseline, false) ||
      !rate(observation.critical) ||
      !rate(observation.direct)
    )
      return false
    if (observation.critical.hits < 5 && observation.normal.count < 5) return false
    used.add(observation.profile)
  }
  return used.size === value.profiles.length
}

export function readEvents(
  input: readonly unknown[],
  modelVersion?: string,
): { events: TelemetryEvent[]; skipped: Skipped } {
  const events: TelemetryEvent[] = [],
    skipped = skippedCounts(),
    seen = new Set<string>()
  for (const item of input) {
    if (!record(item) || item.type !== 'combat.unknown-status') {
      skipped.otherType++
      continue
    }
    if (item.schemaVersion !== 1) {
      skipped.otherVersion++
      continue
    }
    if (
      typeof item.eventId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.eventId) ||
      !version(item.producerVersion) ||
      !payload(item.payload)
    ) {
      skipped.invalidPayload++
      continue
    }
    const id = item.eventId.toLowerCase()
    if (seen.has(id)) {
      skipped.duplicate++
      continue
    }
    seen.add(id)
    if (modelVersion !== undefined && item.payload.modelVersion !== modelVersion) {
      skipped.otherModelVersion++
      continue
    }
    events.push(item as unknown as TelemetryEvent)
  }
  return { events, skipped }
}

export interface Estimate {
  value: number
  low: number
  high: number
  samples: number
  events: number
}
interface Weighted {
  weight: number
  total: number
  samples: number
  events: Set<string>
}
const weighted = (): Weighted => ({ weight: 0, total: 0, samples: 0, events: new Set() })
function contribute(target: Weighted, value: number, variance: number, samples: number, eventId: string): void {
  if (!Number.isFinite(value) || !Number.isFinite(variance) || variance <= 0) return
  const weight = 1 / variance
  if (!Number.isFinite(weight) || !Number.isFinite(weight * value)) return
  target.weight += weight
  target.total += weight * value
  target.samples += samples
  target.events.add(eventId)
}
function estimate(target: Weighted, logarithmic = false): Estimate | null {
  if (!target.weight) return null
  const value = target.total / target.weight,
    half = 1.96 / Math.sqrt(target.weight)
  const transform = logarithmic ? (v: number) => Math.expm1(v) : (v: number) => v
  const result = {
    value: transform(value),
    low: transform(value - half),
    high: transform(value + half),
    samples: target.samples,
    events: target.events.size,
  }
  return [result.value, result.low, result.high].every(Number.isFinite) ? result : null
}
function damageRatio(observation: TelemetryObservation): { value: number; variance: number } | null {
  const a = observation.normal,
    b = observation.baseline
  if (a.count < 2 || b.count < 2) return null
  const mean = a.sum / a.count,
    base = b.sum / b.count
  if (!(mean > 0 && base > 0)) return null
  const relativeVariance = (stats: DamageStats, average: number) =>
    Math.max(
      (stats.sumSquares / stats.count - average ** 2) / (stats.count - 1) / average ** 2,
      0.0289 ** 2 / stats.count,
    )
  return { value: Math.log(mean) - Math.log(base), variance: relativeVariance(a, mean) + relativeVariance(b, base) }
}
function rateDifference(candidate: RateStats, baseline: RateStats): { value: number; variance: number } | null {
  if (!candidate.hits || !baseline.hits) return null
  const p = (candidate.successes + 1) / (candidate.hits + 2),
    q = (baseline.successes + 1) / (baseline.hits + 2)
  return {
    value:
      (candidate.successes - candidate.addedRate) / candidate.hits -
      (baseline.successes - baseline.addedRate) / baseline.hits,
    variance: (p * (1 - p)) / candidate.hits + (q * (1 - q)) / baseline.hits,
  }
}
export interface Summary {
  unknownStatuses: TelemetryObservation['unknownStatuses']
  events: number
  classJobs: number[]
  levels: [number, number]
  criticalHits: number
  normalCount: number
  damage: Estimate | null
  critical: Estimate | null
  direct: Estimate | null
}
export interface ActionSummary {
  unknownStatuses: TelemetryObservation['unknownStatuses']
  actionId: number
  category: ActionType['category'] | null
  damageType: AttackType
  averagePotency: number | null
  normalCount: number
  damage: Estimate | null
}
export interface AnalysisResult {
  skipped: Skipped
  single: Summary[]
  actions: ActionSummary[]
  combinations: Summary[]
}
interface Group {
  statuses: TelemetryObservation['unknownStatuses']
  events: Set<string>
  jobs: Set<number>
  minLevel: number
  maxLevel: number
  criticalHits: number
  normalCount: number
  damage: Weighted
  critical: Weighted
  direct: Weighted
}
export function analyze(
  events: readonly TelemetryEvent[],
  actionTypes: ReadonlyMap<number, ActionType>,
  skipped = skippedCounts(),
): AnalysisResult {
  const groups = new Map<string, Group>()
  const actions = new Map<
    string,
    {
      statuses: Group['statuses']
      actionId: number
      damageType: AttackType
      count: number
      potency: number
      damage: Weighted
    }
  >()
  for (const event of events) {
    const pairs = new Map<string, { group: Group; profile: number; critical: RateStats; direct: RateStats }>()
    for (const observation of event.payload.observations) {
      const key = observation.unknownStatuses.map((s) => `${s.id}:${s.param}`).join(',')
      let group = groups.get(key)
      if (!group) {
        group = {
          statuses: observation.unknownStatuses,
          events: new Set(),
          jobs: new Set(),
          minLevel: 255,
          maxLevel: 1,
          criticalHits: 0,
          normalCount: 0,
          damage: weighted(),
          critical: weighted(),
          direct: weighted(),
        }
        groups.set(key, group)
      }
      const profile = event.payload.profiles[observation.profile]
      group.events.add(event.eventId)
      group.jobs.add(profile.classJob)
      group.minLevel = Math.min(group.minLevel, profile.level)
      group.maxLevel = Math.max(group.maxLevel, profile.level)
      group.criticalHits += observation.critical.hits
      group.normalCount += observation.normal.count
      const actionKey = `${key}/${observation.actionId}`
      let action = actions.get(actionKey)
      if (!action) {
        action = {
          statuses: group.statuses,
          actionId: observation.actionId,
          damageType: observation.damageType,
          count: 0,
          potency: 0,
          damage: weighted(),
        }
        actions.set(actionKey, action)
      }
      action.count += observation.normal.count
      action.potency += observation.normal.potencySum
      const ratio = damageRatio(observation)
      if (ratio) {
        contribute(group.damage, ratio.value, ratio.variance, observation.normal.count, event.eventId)
        contribute(action.damage, ratio.value, ratio.variance, observation.normal.count, event.eventId)
      }
      const pairKey = `${key}/${observation.profile}`
      let pair = pairs.get(pairKey)
      if (!pair) {
        pair = {
          group,
          profile: observation.profile,
          critical: { hits: 0, successes: 0, addedRate: 0 },
          direct: { hits: 0, successes: 0, addedRate: 0 },
        }
        pairs.set(pairKey, pair)
      }
      for (const kind of ['critical', 'direct'] as const) {
        pair[kind].hits += observation[kind].hits
        pair[kind].successes += observation[kind].successes
        pair[kind].addedRate += observation[kind].addedRate
      }
    }
    for (const pair of pairs.values()) {
      for (const kind of ['critical', 'direct'] as const) {
        const difference = rateDifference(pair[kind], event.payload.profiles[pair.profile][kind])
        if (difference)
          contribute(pair.group[kind], difference.value, difference.variance, pair[kind].hits, event.eventId)
      }
    }
  }
  const summaries = [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(
      ([, group]): Summary => ({
        unknownStatuses: group.statuses,
        events: group.events.size,
        classJobs: [...group.jobs].sort((a, b) => a - b),
        levels: [group.minLevel, group.maxLevel],
        criticalHits: group.criticalHits,
        normalCount: group.normalCount,
        damage: estimate(group.damage, true),
        critical: estimate(group.critical),
        direct: estimate(group.direct),
      }),
    )
  return {
    skipped,
    single: summaries.filter((group) => group.unknownStatuses.length === 1),
    combinations: summaries.filter((group) => group.unknownStatuses.length > 1),
    actions: [...actions.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .filter(([, action]) => action.statuses.length === 1)
      .map(([, action]) => ({
        unknownStatuses: action.statuses,
        actionId: action.actionId,
        category: actionTypes.get(action.actionId)?.category ?? null,
        damageType: action.damageType,
        averagePotency: action.count ? action.potency / action.count : null,
        normalCount: action.count,
        damage: estimate(action.damage, true),
      })),
  }
}

export function formatMarkdown(result: AnalysisResult): string {
  const percent = (value: number) => `${(100 * value).toFixed(1)}%`
  const interval = (value: Estimate | null) =>
    value ? `${percent(value.value)} [${percent(value.low)}, ${percent(value.high)}]` : '—'
  const statuses = (value: Summary['unknownStatuses']) => value.map((s) => `${s.id}:${s.param}`).join(', ')
  const summaries = (title: string, rows: Summary[]) => [
    `## ${title}`,
    '',
    '| 状态 ID:param | 事件 | 职业 | 等级 | 伤害比及 95% 区间 | 暴击率差及 95% 区间 | 直击率差及 95% 区间 | 暴击参与次数 | 正常命中数 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map(
      (row) =>
        '| ' +
        [
          statuses(row.unknownStatuses),
          row.events,
          row.classJobs.join(', '),
          row.levels.join('–'),
          interval(row.damage),
          interval(row.critical),
          interval(row.direct),
          row.criticalHits,
          row.normalCount,
        ].join(' | ') +
        ' |',
    ),
  ]
  return [
    '跳过：' +
      Object.entries(result.skipped)
        .map(([key, count]) => `${key}=${count}`)
        .join('，'),
    '',
    '数据局限：同队客户端可能重复观测同一战斗，事件之间不完全独立；状态来源等级可能混合；目标机制可能混入伤害比。结果仅为统计量，需人工核对。',
    '',
    ...summaries('单状态汇总', result.single),
    '',
    '## 单状态各技能明细',
    '',
    '| 状态 ID:param | 技能 | 分类 | 伤害类型 | 平均威力 | 伤害比及 95% 区间 | 正常命中数 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...result.actions.map(
      (row) =>
        '| ' +
        [
          statuses(row.unknownStatuses),
          row.actionId,
          row.category ?? '未知',
          row.damageType,
          row.averagePotency?.toFixed(1) ?? '—',
          interval(row.damage),
          row.normalCount,
        ].join(' | ') +
        ' |',
    ),
    '',
    ...summaries('多状态组合', result.combinations),
    '',
  ].join('\n')
}

export function runCli(
  args: readonly string[],
  readText: (path: string) => string,
  actionTypes: ReadonlyMap<number, ActionType>,
): { exitCode: number; stdout: string; stderr: string } {
  try {
    const paths: string[] = []
    let modelVersion: string | undefined,
      json = false
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]
      if (arg === '--json') json = true
      else if (arg === '--model-version') {
        modelVersion = args[++i]
        if (!modelVersion || modelVersion.startsWith('--')) throw new Error('--model-version requires a version')
      } else if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`)
      else paths.push(arg)
    }
    if (!paths.length) throw new Error('Usage: telemetry-stats [--json] [--model-version VERSION] FILE...')
    const input: unknown[] = []
    for (const path of paths) {
      try {
        const value: unknown = JSON.parse(readText(path))
        const items = Array.isArray(value) ? value : record(value) ? value.items : null
        if (!Array.isArray(items)) throw new Error('Expected an event array or an object with an items array')
        input.push(...items)
      } catch (error) {
        throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const { events, skipped } = readEvents(input, modelVersion)
    const result = analyze(events, actionTypes, skipped)
    return { exitCode: 0, stdout: json ? `${JSON.stringify(result, null, 2)}\n` : formatMarkdown(result), stderr: '' }
  } catch (error) {
    return { exitCode: 1, stdout: '', stderr: `${error instanceof Error ? error.message : String(error)}\n` }
  }
}
