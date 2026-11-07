import { type FightResult, REFLECT_SKILL } from '../model.js'

/** Damage, rates and HP: millions with one decimal, otherwise whole numbers with thousands separators */
export function amount(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  return Math.round(value).toLocaleString('en-US')
}
export const percent = (value: number) => `${value.toFixed(1)}%`
export function duration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
const clock = (date: Date) =>
  `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
/** 今天 20:05, 昨天 20:05 or 10月24日 20:05 in local time */
export function entered(at: number, now: number): string {
  const date = new Date(at)
  const day = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
  const today = day(new Date(now))
  const days = Math.round((today - day(date)) / 86_400_000)
  if (days === 0) return `今天 ${clock(date)}`
  if (days === 1) return `昨天 ${clock(date)}`
  return `${date.getMonth() + 1}月${date.getDate()}日 ${clock(date)}`
}
export const zoneName = (visit: { zoneName: string | null; territoryType: number }) =>
  visit.zoneName ?? `区域 ${visit.territoryType}`
export const skillName = (key: string, names: Record<string, string>) => {
  if (key === REFLECT_SKILL) return '反伤'
  const match = /^(?:action|status):(\d+)(?:@.+)?$/.exec(key)
  return names[key] ?? (match ? `技能 ${match[1]}` : key)
}

export type ResultTag = FightResult | 'running'
export const RESULT_LABELS: Record<ResultTag, string> = {
  kill: '击杀',
  wipe: '团灭',
  ended: '结束',
  running: '进行中',
}
/** The mark mojito-base.css draws beside the word: a check for a kill, a cross for a wipe */
export const RESULT_MARKS: Record<ResultTag, 'check' | 'cross' | 'dash' | 'dot'> = {
  kill: 'check',
  wipe: 'cross',
  ended: 'dash',
  running: 'dot',
}
/** The tone of mojito-base.css's status chip */
export const RESULT_TONES: Record<ResultTag, 'ok' | 'danger' | undefined> = {
  kill: 'ok',
  wipe: 'danger',
  ended: undefined,
  running: 'ok',
}
/** 23 场 · 击杀 1 · 团灭 21; a result that did not happen is left out */
export function fightCounts(fights: { result: FightResult | 'running' | null }[]): string {
  const parts = [`${fights.length} 场`]
  for (const [result, label] of [
    ['kill', '击杀'],
    ['wipe', '团灭'],
    ['ended', '结束'],
  ] as const) {
    const count = fights.filter((fight) => fight.result === result).length
    if (count) parts.push(`${label} ${count}`)
  }
  return parts.join(' · ')
}
