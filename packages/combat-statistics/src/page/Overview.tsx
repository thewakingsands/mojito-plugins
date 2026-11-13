import { type CSSProperties, Fragment, type ReactNode, useState } from 'react'
import { roleOf } from '../jobs.js'
import type { RowSummary, Summary } from '../model.js'
import type { Selection, StatisticsState, VisitView } from '../view-model.js'
import { useBridge } from './bridge.js'
import { fightFacts, ResultLabel } from './fight.js'
import { duration, entered, percent, zoneName } from './format.js'
import { JobIcon, SkillIcon } from './icons.js'
import { showBanner, toggle } from './state.js'
import {
  type Cell,
  type Column,
  DAMAGE_COLUMNS,
  damageCells,
  damageRows,
  damageSkills,
  HEAL_COLUMNS,
  healerCells,
  healerRows,
  healSkills,
  rdpsUnavailable,
  type SkillLine,
  skillLabel,
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
        <div className="mojito-empty">
          <h2>还没有战斗记录</h2>
          <p>进入区域并开始战斗后，这里会显示记录。</p>
        </div>
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
      ? '日志不可用，无法打开战斗回顾'
      : !fight || facts?.result === 'running' || summary?.outcome.result === null
        ? '战斗结束后才能打开战斗回顾'
        : null
  const subtitle = [visit && zoneName(visit), summary && entered(summary.startAt, Date.now())].filter(Boolean)
  // The fight at a glance, label over value, above the tables
  const team = summary && !statistics.loading && !statistics.loadError ? teamFacts(summary) : null
  const glance = facts && [
    ['时长', duration(facts.durationMs)],
    team && ['团队 DPS', team],
    ['死亡', String(facts.deaths)],
    facts.result === 'wipe' && facts.hpPercent !== null && ['敌人剩余', percent(facts.hpPercent)],
  ]
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
            data-variant="primary"
            disabled={!!blocked}
            title={blocked || undefined}
            onClick={() => props.onReview(selection)}
          >
            战斗回顾
          </button>
        </div>
      </header>
      {glance && (
        <dl className="mojito-facts fight-facts">
          {glance
            .filter((fact): fact is string[] => !!fact)
            .map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd className="number">{value}</dd>
              </div>
            ))}
        </dl>
      )}
      {body}
    </>
  )
}

function Tables({ summary, names }: { summary: Summary; names: Record<string, string> }) {
  // Kept by actor across refreshes; the two tables expand independently.
  const [damageOpen, setDamageOpen] = useState<ReadonlySet<string>>(new Set())
  const [healOpen, setHealOpen] = useState<ReadonlySet<string>>(new Set())
  const rows = damageRows(summary)
  const healers = healerRows(summary)
  const damageTop = Math.max(0, ...rows.map((row) => row.metrics.encDps?.value ?? 0))
  // Without rDPS on any row, the column is left out and its reason is told once beside the title.
  const noRdps = rdpsUnavailable(summary)
  const kept = DAMAGE_COLUMNS.map((column) => !(noRdps !== null && column.className.includes('col-rdps')))
  const damageColumns = DAMAGE_COLUMNS.filter((_, index) => kept[index])
  const pick = (cells: Cell[]) => cells.filter((_, index) => kept[index])
  const healTop = Math.max(0, ...healers.map((row) => row.metrics.encHps?.value ?? 0))
  return (
    <>
      <section className="mojito-panel table-panel">
        <header>
          <h2>伤害</h2>
          {noRdps !== null && <p className="hint">rDPS 不可用：{noRdps}</p>}
        </header>
        <table className="stats damage">
          <Head columns={damageColumns} />
          <tbody>
            {rows.map((row) => (
              <ActorRows
                key={row.actor.key}
                row={row}
                names={names}
                columns={damageColumns}
                cells={pick(damageCells(row, summary))}
                share={damageTop > 0 ? (row.metrics.encDps?.value ?? 0) / damageTop : 0}
                skills={damageSkills(row, summary).map((skill) => ({ ...skill, cells: pick(skill.cells) }))}
                open={damageOpen.has(row.actor.key)}
                onToggle={() => setDamageOpen((keys) => toggle(keys, row.actor.key))}
              />
            ))}
            {rows.length > 0 && (
              <tr className="total">
                <td />
                <Cells columns={damageColumns} cells={pick(totalCells(rows, summary))} />
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
            <Head columns={HEAL_COLUMNS} />
            <tbody>
              {healers.map((row) => (
                <ActorRows
                  key={row.actor.key}
                  row={row}
                  names={names}
                  columns={HEAL_COLUMNS}
                  cells={healerCells(row)}
                  share={healTop > 0 ? (row.metrics.encHps?.value ?? 0) / healTop : 0}
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
  columns: Column[]
  cells: Cell[]
  skills: SkillLine[]
  /** The row's value against the table's highest, drawn as a bar behind the name */
  share: number
  open: boolean
  onToggle: () => void
}) {
  const { row, names, open } = props
  const role = roleOf(row.actor.job) ?? 'dps'
  const limitBreak = row.actor.kind === 'limitBreak'
  const name = limitBreak ? '极限技' : (row.actor.name ?? `角色 ${row.actor.id}`)
  return (
    <Fragment>
      <tr
        className={`actor ${role}`}
        style={{ '--share': props.share } as CSSProperties}
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
            <span className="mojito-chevron" aria-hidden="true" />
            {limitBreak ? (
              props.skills.length > 0 ? (
                <SkillIcon skill={props.skills[0].key} />
              ) : (
                <span className="icon" />
              )
            ) : (
              <JobIcon job={row.actor.job} abbreviation={names[`job:${row.actor.job}`]} />
            )}
            <span className="ellipsis">{name}</span>
          </span>
        </td>
        <Cells columns={props.columns} cells={props.cells} />
      </tr>
      {open &&
        props.skills.map((skill) => {
          const label = skillLabel(row, skill.key, names)
          return (
            <tr key={skill.key} className="skill">
              <td title={label}>
                <span className="name">
                  <SkillIcon skill={skill.key} />
                  <span className="ellipsis">{label}</span>
                </span>
              </td>
              <Cells columns={props.columns} cells={skill.cells} />
            </tr>
          )
        })}
    </Fragment>
  )
}

/** Team DPS as the total row sums it. Team rDPS is not shown: the rDPS of the members add up to the total damage. */
const teamFacts = (summary: Summary) => totalCells(damageRows(summary), summary)[0].text

/** The width of each column is set on its header; table-layout: fixed takes the widths from the first row. */
const Head = ({ columns }: { columns: Column[] }) => (
  <thead>
    <tr>
      <th>角色</th>
      {columns.map((column) => (
        <th key={column.label} className={column.className}>
          {column.label}
        </th>
      ))}
    </tr>
  </thead>
)

const Cells = ({ columns, cells }: { columns: Column[]; cells: Cell[] }) =>
  cells.map((cell, index) => (
    <td key={index} className={columns[index]?.className} title={cell.title}>
      {cell.text}
    </td>
  ))
