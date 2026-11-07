import { Fragment, type ReactNode, useState } from 'react'
import type { RowSummary, Summary } from '../model.js'
import type { Selection, StatisticsState, VisitView } from '../view-model.js'
import { useBridge } from './bridge.js'
import { fightFacts, ResultLabel } from './fight.js'
import { duration, entered, percent, skillName, zoneName } from './format.js'
import { JobIcon, SkillIcon } from './icons.js'
import { showBanner, toggle } from './state.js'
import {
  type Cell,
  damageCells,
  damageRows,
  damageSkills,
  healerCells,
  healerRows,
  healSkills,
  type SkillLine,
  totalCells,
} from './tables.js'

export function Overview(props: {
  statistics: StatisticsState
  /** The visit of the selected fight */
  visit: VisitView | undefined
  onCurrent: () => void
  onReview: (fight: Selection) => void
}) {
  const { statistics, visit } = props
  const { command } = useBridge()
  const banner = showBanner(statistics) && (
    <div className="mojito-callout banner" role="status">
      <span>当前战斗进行中</span>
      <button
        type="button"
        onClick={() => {
          props.onCurrent()
          void command({ kind: 'current' })
        }}
      >
        回到当前战斗
      </button>
    </div>
  )
  const selection = statistics.selection
  if (!selection)
    return (
      <>
        {banner}
        <p className="mojito-empty">还没有战斗记录。进入区域并开始战斗后，这里会显示记录。</p>
      </>
    )
  const fight = visit?.fights.find((item) => item.id === selection.fightId)
  const summary = statistics.selected
  let body: ReactNode
  if (statistics.loading) body = <p className="mojito-empty">正在读取日志</p>
  else if (statistics.loadError)
    body = (
      <p className="mojito-callout" data-tone="danger">
        无法读取这次进本的日志：{statistics.loadError}
      </p>
    )
  else if (summary) body = <Tables summary={summary} names={statistics.names} />
  const facts = fight && fightFacts(fight, statistics)
  const blocked =
    visit?.status === 'failed'
      ? '日志不可用'
      : !fight || facts?.result === 'running' || summary?.outcome.result === null
        ? '战斗结束后可以回顾'
        : null
  const mainEnemy = summary?.outcome.mainEnemy ?? fight?.mainEnemy
  const subtitle = [
    visit && zoneName(visit),
    summary && entered(summary.startAt, Date.now()),
    facts && duration(facts.durationMs),
    facts?.result === 'wipe' && mainEnemy?.hpPercent != null && `敌人剩余 ${percent(mainEnemy.hpPercent)}`,
  ].filter(Boolean)
  return (
    <>
      {banner}
      <header className="overview-head">
        <div>
          <h1>
            <span className="ellipsis">
              {fight && <span className="number">#{fight.number}</span>} {facts?.enemy ?? '未知敌人'}
            </span>
            {facts && <ResultLabel result={facts.result} />}
          </h1>
          <p className="subtitle">{subtitle.join(' · ')}</p>
        </div>
        <div className="overview-actions">
          <button
            type="button"
            className="small"
            disabled={!!blocked}
            title={blocked || undefined}
            onClick={() => props.onReview(selection)}
          >
            副本回顾
          </button>
        </div>
      </header>
      {body}
    </>
  )
}

const DAMAGE_COLUMNS = ['DPS', 'rDPS', '暴击率', '直击率', '直爆率', '受到伤害', '死亡']
const HEAL_COLUMNS = ['HPS', '过量 %']

function Tables({ summary, names }: { summary: Summary; names: Record<string, string> }) {
  // Kept by actor across refreshes; the two tables expand independently.
  const [damageOpen, setDamageOpen] = useState<ReadonlySet<string>>(new Set())
  const [healOpen, setHealOpen] = useState<ReadonlySet<string>>(new Set())
  const rows = damageRows(summary)
  const healers = healerRows(summary)
  return (
    <>
      <section className="mojito-panel table-panel">
        <header>
          <h2>伤害</h2>
        </header>
        <table className="stats damage">
          <colgroup>
            <col />
            <col className="amount" />
            <col className="amount" />
            <col className="rate" />
            <col className="rate" />
            <col className="rate" />
            <col className="amount" />
            <col className="count" />
          </colgroup>
          <thead>
            <tr>
              <th>角色</th>
              {DAMAGE_COLUMNS.map((name) => (
                <th key={name}>{name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <ActorRows
                key={row.actor.key}
                row={row}
                names={names}
                cells={damageCells(row, summary)}
                skills={damageSkills(row, summary)}
                open={damageOpen.has(row.actor.key)}
                onToggle={() => setDamageOpen((keys) => toggle(keys, row.actor.key))}
              />
            ))}
            {rows.length > 0 && (
              <tr className="total">
                <td />
                <Cells cells={totalCells(rows, summary)} />
              </tr>
            )}
          </tbody>
        </table>
      </section>
      {healers.length > 0 && (
        <section className="mojito-panel table-panel">
          <header>
            <h2>治疗</h2>
          </header>
          <table className="stats heal">
            <colgroup>
              <col />
              <col className="amount" />
              <col className="rate" />
            </colgroup>
            <thead>
              <tr>
                <th>角色</th>
                {HEAL_COLUMNS.map((name) => (
                  <th key={name}>{name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {healers.map((row) => (
                <ActorRows
                  key={row.actor.key}
                  row={row}
                  names={names}
                  cells={healerCells(row)}
                  skills={healSkills(row, summary)}
                  open={healOpen.has(row.actor.key)}
                  onToggle={() => setHealOpen((keys) => toggle(keys, row.actor.key))}
                />
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  )
}

function ActorRows(props: {
  row: RowSummary
  names: Record<string, string>
  cells: Cell[]
  skills: SkillLine[]
  open: boolean
  onToggle: () => void
}) {
  const { row, names, open } = props
  const name = row.actor.name ?? `角色 ${row.actor.id}`
  return (
    <Fragment>
      <tr
        className="actor"
        tabIndex={0}
        aria-expanded={open}
        onClick={props.onToggle}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          props.onToggle()
        }}
      >
        <td title={name}>
          <span className="name">
            <JobIcon job={row.actor.job} abbreviation={names[`job:${row.actor.job}`]} />
            <span className="ellipsis">{name}</span>
          </span>
        </td>
        <Cells cells={props.cells} />
      </tr>
      {open &&
        props.skills.map((skill) => {
          const label = skillName(skill.key, names)
          return (
            <tr key={skill.key} className="skill">
              <td title={label}>
                <span className="name">
                  <SkillIcon skill={skill.key} />
                  <span className="ellipsis">{label}</span>
                </span>
              </td>
              <Cells cells={skill.cells} />
            </tr>
          )
        })}
    </Fragment>
  )
}

const Cells = ({ cells }: { cells: Cell[] }) =>
  cells.map((cell, index) => (
    <td key={index} title={cell.title}>
      {cell.text}
    </td>
  ))
