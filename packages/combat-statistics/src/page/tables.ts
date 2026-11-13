import { roleOf } from '../jobs.js'
import { type Metric, REFLECT_SKILL, type RowSummary, type Summary } from '../model.js'
import { skillCaster } from '../view-model.js'
import { percent, skillName, whole } from './format.js'

/** One table cell; title explains a value that is not available. */
export interface Cell {
  text: string
  title?: string
}
export interface SkillLine {
  key: string
  cells: Cell[]
}
const blank: Cell = { text: '' }
const dash = (reason: string): Cell => ({ text: '—', title: reason })
const value = (input: Metric | undefined, format: (value: number) => string): Cell =>
  input && input.value !== null ? { text: format(input.value) } : dash(input?.reason ?? '没有可用输入')
const ratio = (part: number, all: number) => (all > 0 ? (part * 100) / all : null)
/** The rDPS of a row or skill; the encounter's reason stands in when the metric gives none. */
const rdps = (input: Metric | undefined, summary: Summary): Cell =>
  input && input.value !== null
    ? { text: whole(input.value) }
    : dash(input?.reason ?? summary.contributionUnavailable ?? '没有可用输入')
const order = (input: Metric | undefined) => input?.value ?? -Infinity
const seconds = (summary: Summary) => (summary.durationMs ?? summary.endAt - summary.startAt) / 1000
const isLimitBreak = (row: RowSummary) => row.actor.kind === 'limitBreak'
const NO_LIMIT_BREAK_DATA = '极限技没有这项数据'

/** The name of a caster of a limit break, from their actor key when the name is not known */
export const casterName = (key: string, name: string | null | undefined) => name ?? `角色 ${key.split(':').at(-1)}`

/** The name of a skill of the row; on the limit break row it names who used it as well */
export function skillLabel(row: RowSummary, key: string, names: Record<string, string>): string {
  const caster = isLimitBreak(row) ? skillCaster(key) : null
  if (caster === null) return skillName(key, names)
  return `${skillName(key, names)} · ${casterName(caster, row.casters?.[caster]?.name)}`
}

export interface Column {
  label: string
  /** Shared by the header and every cell of the column: the header's class sets the width, and the overview hides
   * a column by its class when the panel is narrow. */
  className: string
}
/** In the order of damageCells */
export const DAMAGE_COLUMNS: Column[] = [
  { label: 'DPS', className: 'col-amount' },
  { label: 'rDPS', className: 'col-amount col-rdps' },
  { label: '暴击率', className: 'col-rate' },
  { label: '直击率', className: 'col-rate' },
  { label: '直爆率', className: 'col-rate' },
  { label: '受到伤害', className: 'col-taken' },
  { label: '死亡', className: 'col-count' },
]
/** In the order of healerCells */
export const HEAL_COLUMNS: Column[] = [
  { label: 'HPS', className: 'col-amount' },
  { label: '过量 %', className: 'col-rate' },
]

/**
 * Why no row of the damage table has rDPS, or null when some row has it or there are no rows; the table then leaves
 * the column out and says why once.
 */
export function rdpsUnavailable(summary: Summary): string | null {
  const rows = summary.rows
  if (!rows.length || rows.some((row) => row.metrics.contributionDps?.value != null)) return null
  return (
    summary.contributionUnavailable ??
    rows.find((row) => row.metrics.contributionDps?.reason)?.metrics.contributionDps.reason ??
    '没有可用输入'
  )
}

/** The damage table lists every row, highest DPS first. */
export const damageRows = (summary: Summary) =>
  [...summary.rows].sort((a, b) => order(b.metrics.encDps) - order(a.metrics.encDps))

/** DPS, rDPS, critical, direct-hit and critical direct-hit rates, damage taken, deaths */
export function damageCells(row: RowSummary, summary: Summary): Cell[] {
  if (isLimitBreak(row)) {
    const none = dash(NO_LIMIT_BREAK_DATA)
    return [value(row.metrics.encDps, whole), rdps(row.metrics.contributionDps, summary), none, none, none, none, none]
  }
  return [
    value(row.metrics.encDps, whole),
    rdps(row.metrics.contributionDps, summary),
    value(row.metrics.critPct, percent),
    value(row.metrics.directPct, percent),
    value(row.metrics.critDirectPct, percent),
    { text: whole(row.totals.taken) },
    { text: String(row.totals.deaths) },
  ]
}

/** The sums of the rows; the rates are left empty and rDPS is not available when any row lacks it. */
export function totalCells(rows: RowSummary[], summary: Summary): Cell[] {
  const sum = (pick: (row: RowSummary) => number) => rows.reduce((total, row) => total + pick(row), 0)
  const missing = rows.find((row) => row.metrics.contributionDps?.value == null)
  return [
    { text: whole(sum((row) => row.metrics.encDps?.value ?? 0)) },
    missing
      ? rdps(missing.metrics.contributionDps, summary)
      : { text: whole(sum((row) => row.metrics.contributionDps.value!)) },
    blank,
    blank,
    blank,
    { text: whole(sum((row) => row.totals.taken)) },
    { text: String(sum((row) => row.totals.deaths)) },
  ]
}

/**
 * The skills of a row that dealt damage or gave rDPS, most damage first. Damage over time carries no critical or
 * direct-hit flags, so its rates are not available.
 */
export function damageSkills(row: RowSummary, summary: Summary): SkillLine[] {
  const duration = seconds(summary)
  return Object.entries(row.skills)
    .filter(([, skill]) => skill.damage > 0 || (skill.contributionDps?.value ?? 0) !== 0)
    .sort((a, b) => b[1].damage - a[1].damage)
    .map(([key, skill]) => {
      const rate = (part: number) => {
        if (isLimitBreak(row)) return dash(NO_LIMIT_BREAK_DATA)
        if (key.startsWith('status:')) return dash('持续伤害没有暴击和直击标记')
        if (key === REFLECT_SKILL) return dash('反伤没有暴击和直击标记')
        const result = ratio(part, skill.directHits ?? 0)
        return result === null ? dash('没有直接伤害') : { text: percent(result) }
      }
      return {
        key,
        cells: [
          duration > 0 ? { text: whole(skill.damage / duration) } : dash('战斗时长为零'),
          rdps(skill.contributionDps, summary),
          rate(skill.crit ?? 0),
          rate(skill.direct ?? 0),
          rate(skill.critDirect ?? 0),
          blank,
          blank,
        ],
      }
    })
}

/** Healers only, and the limit break row when it healed, highest HPS first; a row of unknown job is left out. */
export const healerRows = (summary: Summary) =>
  summary.rows
    .filter((row) => roleOf(row.actor.job) === 'healer' || (isLimitBreak(row) && row.totals.healing > 0))
    .sort((a, b) => order(b.metrics.encHps) - order(a.metrics.encHps))

const overheal = (overhealed: Metric | undefined, healing: number): Cell => {
  if (healing <= 0) return dash('没有治疗')
  if (!overhealed || overhealed.value === null) return dash(overhealed?.reason ?? '没有可用输入')
  return {
    text: percent((overhealed.value * 100) / healing),
    ...(overhealed.reason ? { title: overhealed.reason } : {}),
  }
}
/** HPS and overheal % */
export function healerCells(row: RowSummary): Cell[] {
  return [value(row.metrics.encHps, whole), overheal(row.metrics.overheal, row.totals.healing)]
}

/** The skills of a row that healed, including heals over time, most healing first */
export function healSkills(row: RowSummary, summary: Summary): SkillLine[] {
  const duration = seconds(summary)
  return Object.entries(row.skills)
    .filter(([, skill]) => skill.healing > 0)
    .sort((a, b) => b[1].healing - a[1].healing)
    .map(([key, skill]) => ({
      key,
      cells: [
        duration > 0 ? { text: whole(skill.healing / duration) } : dash('战斗时长为零'),
        overheal(skill.overheal, skill.healing),
      ],
    }))
}
