import { useState } from 'react'
import type { FightEntry } from '../log/types.js'
import type { Selection, StatisticsState, VisitsState, VisitView } from '../view-model.js'
import { useBridge, useChannel } from './bridge.js'
import { fightFacts, ResultLabel } from './fight.js'
import { duration, entered, fightCounts, zoneName } from './format.js'
import { Overview } from './Overview.js'
import { ReplayView } from './replay/ReplayView.js'
import { expandedAfter, toggleVisit } from './state.js'

const key = (selection: Selection | null) => (selection ? `${selection.visitId}/${selection.fightId}` : '')

export function App() {
  const statistics = useChannel<StatisticsState>('statistics')
  const visits = useChannel<VisitsState>('visits')?.visits ?? []
  const [expanded, setExpanded] = useState<string | null>(null)
  // The overview stays mounted under the review, so its expanded visit and table rows are there on return.
  const [review, setReview] = useState<Selection | null>(null)
  // The selection the expanded visit was last matched to; undefined until the first state arrives.
  const [matched, setMatched] = useState<Selection | null | undefined>(undefined)
  if (statistics && (matched === undefined || key(matched) !== key(statistics.selection))) {
    setMatched(statistics.selection)
    setExpanded(expandedAfter(expanded, matched, statistics))
  }
  const status = [statistics?.paused && 'Mojito没有正常返回游戏数据，统计已暂停。', statistics?.inputError]
    .filter(Boolean)
    .join(' · ')
  return (
    <>
      {review && (
        <ReplayView
          visitId={review.visitId}
          fightId={review.fightId}
          statistics={statistics}
          visit={visits.find((visit) => visit.id === review.visitId)}
          onBack={() => setReview(null)}
        />
      )}
      <div className="layout" hidden={review !== null}>
        {status && (
          <p className="status" role="status">
            {status}
          </p>
        )}
        <nav className="visits" aria-label="最近进本">
          <h2>最近进本</h2>
          {visits.map((visit) => (
            <VisitItem
              key={visit.id}
              visit={visit}
              statistics={statistics}
              expanded={expanded === visit.id}
              onToggle={() => setExpanded((current) => toggleVisit(current, visit.id))}
            />
          ))}
        </nav>
        <main className="overview">
          {statistics && (
            <Overview
              statistics={statistics}
              visits={visits}
              onCurrent={() => setExpanded(visits.find((visit) => visit.current)?.id ?? expanded)}
              onReview={setReview}
            />
          )}
        </main>
      </div>
    </>
  )
}

function VisitItem(props: {
  visit: VisitView
  statistics: StatisticsState | null
  expanded: boolean
  onToggle: () => void
}) {
  const { visit, statistics, expanded } = props
  const selected = statistics?.selection?.visitId === visit.id
  return (
    <section className={`visit${expanded ? ' expanded' : ''}`}>
      <button type="button" className={`visit-head${selected ? ' selected' : ''}`} onClick={props.onToggle}>
        <span className="visit-title">
          <span className="ellipsis">{zoneName(visit)}</span>
          {visit.current && <span className="tag running">● 进行中</span>}
        </span>
        <span className="visit-meta">
          {entered(visit.enteredAt, Date.now())} ·{' '}
          {fightCounts(visit.fights.map((fight) => fightFacts(fight, statistics)))}
        </span>
        {visit.status === 'failed' && <span className="visit-error">⚠ 日志不可用</span>}
      </button>
      {expanded && (
        <ul className="fights">
          {[...visit.fights].reverse().map((fight) => (
            <FightItem key={fight.id} visit={visit} fight={fight} statistics={statistics} />
          ))}
        </ul>
      )}
    </section>
  )
}

function FightItem({
  visit,
  fight,
  statistics,
}: {
  visit: VisitView
  fight: FightEntry
  statistics: StatisticsState | null
}) {
  const { command } = useBridge()
  const facts = fightFacts(fight, statistics)
  const selected = statistics?.selection?.fightId === fight.id
  return (
    <li>
      <button
        type="button"
        className={`fight${selected ? ' selected' : ''}`}
        aria-current={selected || undefined}
        onClick={() => void command({ kind: 'select', visitId: visit.id, fightId: fight.id })}
      >
        <span className="fight-title">
          <span className="ellipsis">
            <span className="number">#{fight.number}</span> {facts.enemy}
          </span>
          <ResultLabel result={facts.result} />
        </span>
        <span className="fight-meta" data-duration-ms={facts.durationMs}>
          <span className="number">{duration(facts.durationMs)}</span> · 死亡{' '}
          <span className="number">{facts.deaths}</span>
        </span>
      </button>
    </li>
  )
}
