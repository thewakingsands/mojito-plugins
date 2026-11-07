import type { FightEntry } from '../log/types.js'
import type { StatisticsState } from '../view-model.js'
import { RESULT_LABELS, RESULT_MARKS, RESULT_TONES, type ResultTag } from './format.js'

/**
 * A fight in progress shows its live summary; the log knows its result only after it ends. A selected fight shows
 * the result of its summary, which a log written by an older version may have recorded differently.
 */
export function fightFacts(fight: FightEntry, statistics: StatisticsState | null) {
  const live = statistics?.activeFightId === fight.id ? statistics.current : null
  const selected = !live && statistics?.selected?.id === fight.id ? statistics.selected.outcome : null
  const result: ResultTag = live ? 'running' : (selected?.result ?? fight.result ?? 'ended')
  return {
    result,
    enemy: (live ? live.outcome.mainEnemy?.name : (selected?.mainEnemy?.name ?? fight.mainEnemy?.name)) ?? '未知敌人',
    durationMs: live ? (live.durationMs ?? 0) : (fight.durationMs ?? 0),
    deaths: live ? live.rows.reduce((sum, row) => sum + row.totals.deaths, 0) : (fight.deaths ?? 0),
  }
}

export const ResultLabel = ({ result }: { result: ResultTag }) => (
  <span className={`mojito-chip tag ${result}`} data-tone={RESULT_TONES[result]} data-mark={RESULT_MARKS[result]}>
    {RESULT_LABELS[result]}
  </span>
)
