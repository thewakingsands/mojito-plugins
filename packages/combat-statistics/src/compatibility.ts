import { formatMetric, type OverlayState } from '@ffcafe/mojito-plugin-sdk/overlayplugin'
import type { Summary } from './model.js'

const LIMIT_BREAK = 'Limit Break'
const duration = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
export function compatibility(
  summary: Summary | null,
  player: OverlayState['primaryPlayer'],
  zone: OverlayState['zone'],
  language: string | null,
  inCombat: boolean | null,
  names: { actions?: ReadonlyMap<number, string>; title?: string | null } = {},
): OverlayState {
  if (language === 'chs' || language === 'cht') language = 'cn'
  const unknown = (reason: string) => ({ state: 'unavailable' as const, reason })
  const state: OverlayState = {
    apiVersion: 1,
    encounterId: summary?.id ?? null,
    combatData: null,
    primaryPlayer: player,
    zone,
    language: language && ['en', 'de', 'fr', 'ja', 'cn', 'ko'].includes(language) ? language : null,
    inCombat,
    availability: {
      combatData: unknown('还没有统计场次'),
      primaryPlayer: player ? { state: 'available' } : unknown('本角色身份未知'),
      zone: zone ? { state: 'available' } : unknown('区域未知'),
      language: unknown('语言未知'),
      inCombat: inCombat === null ? unknown('真实战斗状态尚未提供') : { state: 'available' },
    },
  }
  if (state.language) state.availability.language = { state: 'available' }
  if (!summary) return state
  // Precise durations can differ from ACT's integer-second durations when templates recalculate short encounters.
  const seconds = (summary.durationMs ?? summary.endAt - summary.startAt) / 1000
  const encounter: Record<string, string> = {
    title: names.title ?? summary.title ?? zone?.name ?? `区域 ${summary.zone ?? '?'}`,
    CurrentZoneName: zone?.name ?? `区域 ${summary.zone ?? '?'}`,
    duration: duration(seconds),
    DURATION: String(seconds),
    damage: String(summary.encounterDamage.value),
    healed: String(summary.reportedHealing.value),
  }
  if (seconds > 0) {
    encounter.encdps = formatMetric(summary.encounterDamage.value! / seconds)!
    encounter.enchps = formatMetric(summary.reportedHealing.value! / seconds)!
    encounter.ENCDPS = formatMetric(summary.encounterDamage.value! / seconds, 0)!
    encounter.ENCHPS = formatMetric(summary.reportedHealing.value! / seconds, 0)!
  }
  encounter.hits = String(summary.rows.reduce((sum, row) => sum + row.totals.hits, 0))
  const combatants: Record<string, Record<string, string>> = {}
  for (const row of summary.rows) {
    const actorSeconds = (row.lastAt - row.firstAt) / 1000
    const label = row.actor.name ?? `Actor ${row.actor.id}`
    const limitBreak = row.actor.kind === 'limitBreak'
    const self = !limitBreak && row.actor.id === player?.id
    // Templates display `name`, while the key has to stay unique across same-named actors from different worlds. The
    // limit break row is named as ACT names it in every language, which the templates look for.
    const key = limitBreak
      ? LIMIT_BREAK
      : self
        ? 'YOU'
        : `${label}@${row.actor.worldId ?? '?'} [${row.actor.id.toString(16)}]`
    const fields: Record<string, string> = {
      name: limitBreak ? LIMIT_BREAK : self ? 'YOU' : label,
      Job: limitBreak ? LIMIT_BREAK : row.actor.kind === 'pet' ? 'pet' : jobName(row.actor.job),
      damage: String(row.totals.damage),
      healed: String(row.totals.healing),
      damagetaken: String(row.totals.taken),
      healstaken: String(row.totals.healingTaken),
      swings: String(row.totals.swings),
      hits: String(row.totals.hits),
      misses: String(row.totals.misses),
      crithits: String(row.totals.crit),
      DirectHitCount: String(row.totals.direct),
      CritDirectHitCount: String(row.totals.critDirect),
      deaths: String(row.totals.deaths),
      duration: duration(actorSeconds),
      DURATION: String(actorSeconds),
    }
    for (const [key, metricName] of Object.entries({
      encdps: 'encDps',
      enchps: 'encHps',
      dps: 'dps',
      hps: 'hps',
      'damage%': 'damagePct',
      'healed%': 'healingPct',
      'crithit%': 'critPct',
      DirectHitPct: 'directPct',
      CritDirectHitPct: 'critDirectPct',
      Last10DPS: 'last10Dps',
      Last30DPS: 'last30Dps',
      Last60DPS: 'last60Dps',
    })) {
      const value = formatMetric(row.metrics[metricName]?.value ?? null)
      if (value !== undefined) fields[key] = key.includes('%') || key.endsWith('Pct') ? `${value}%` : value
    }
    const overheal = row.metrics.overheal?.value ?? null
    if (overheal !== null && row.totals.healing > 0)
      fields.OverHealPct = `${formatMetric((overheal * 100) / row.totals.healing)}%`
    if (fields.encdps !== undefined) fields.ENCDPS = formatMetric(row.metrics.encDps.value, 0)!
    if (fields.enchps !== undefined) fields.ENCHPS = formatMetric(row.metrics.encHps.value, 0)!
    if (row.maxHit) {
      fields.maxhit = `${names.actions?.get(row.maxHit.actionId) ?? `#${row.maxHit.actionId}`}-${row.maxHit.amount}`
      fields.MAXHIT = String(row.maxHit.amount)
    }
    if (row.maxHeal) {
      fields.maxheal = `${names.actions?.get(row.maxHeal.actionId) ?? `#${row.maxHeal.actionId}`}-${row.maxHeal.amount}`
      fields.MAXHEAL = String(row.maxHeal.amount)
    }
    combatants[key] = fields
  }
  state.combatData = { Encounter: encounter, Combatant: combatants, isActive: summary.ended ? 'false' : 'true' }
  state.availability.combatData = {
    state: 'partial',
    reason: [
      ...summary.quality,
      '盾与贡献 DPS 不可用',
      ...(summary.diagnostics.unassignedObservedDamage ? ['存在未分配周期伤害'] : []),
    ].join('；'),
  }
  return state
}
const jobs: Record<number, string> = {
  19: 'PLD',
  20: 'MNK',
  21: 'WAR',
  22: 'DRG',
  23: 'BRD',
  24: 'WHM',
  25: 'BLM',
  27: 'SMN',
  28: 'SCH',
  30: 'NIN',
  31: 'MCH',
  32: 'DRK',
  33: 'AST',
  34: 'SAM',
  35: 'RDM',
  36: 'BLU',
  37: 'GNB',
  38: 'DNC',
  39: 'RPR',
  40: 'SGE',
  41: 'VPR',
  42: 'PCT',
}
const jobName = (id: number | null) => (id === null ? '' : (jobs[id] ?? ''))
