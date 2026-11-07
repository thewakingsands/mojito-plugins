import { Fragment, memo, type ReactNode } from 'react'
import type { ReplayData } from '../../view-model.js'
import { amount, percent, skillName } from '../format.js'
import { JobIcon, SkillIcon } from '../icons.js'
import {
  damageRows,
  healByActor,
  healBySkill,
  healByTarget,
  type Scope,
  takenByActor,
  takenBySkill,
} from './aggregate.js'
import { ActorIcon, actorName, statusName } from './parts.js'
import { uptimeGroups } from './uptime.js'

export type TakenGroup = 'actor' | 'skill'
export type HealGroup = 'actor' | 'skill' | 'target'
const DASH = '—'
const number = (value: number | null) => (value === null ? DASH : amount(value))
const rate = (value: number | null) => (value === null ? DASH : percent(value * 100))
/** The set with the index added, or removed when it was there */
function flip(set: ReadonlySet<number>, index: number) {
  const next = new Set(set)
  if (!next.delete(index)) next.add(index)
  return next
}
/** A skill key as its name: an Action, or a Status for damage and healing over time */
function skillLabel(data: ReplayData, key: string) {
  const match = /^(action|status):(\d+)$/.exec(key)
  if (!match) return skillName(key, {})
  const id = Number(match[2])
  // A summed tick carries no status id and its source is unknown; it only shows up in damage taken.
  if (match[1] === 'status' && id === 0) return '持续伤害'
  if (match[1] === 'status') return statusName(data, id)
  return data.actions.find((action) => action.actionId === id)?.name ?? `技能 #${id}`
}

interface TableProps {
  data: ReplayData
  scope: Scope
  names: Record<string, string>
  /** The span and filter, as the toolbar writes them */
  scopeText: string
  open: ReadonlySet<number>
  onOpen: (open: ReadonlySet<number>) => void
}

function Toolbar(props: { children?: ReactNode; scopeText: string }) {
  return (
    <div className="detail-toolbar">
      {props.children}
      <span className="grow" />
      <span>{props.scopeText}</span>
    </div>
  )
}
export function Segments<T extends string>(props: {
  value: T
  options: readonly (readonly [T, string])[]
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div className="segments" role="radiogroup" aria-label={props.label}>
      {props.options.map(([value, label]) => (
        // biome-ignore lint/a11y/useSemanticElements: a segmented control, not a native radio input
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={props.value === value}
          className={props.value === value ? 'on' : ''}
          onClick={() => props.onChange(value)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function ActorCell(props: { data: ReplayData; actor: number; names: Record<string, string> }) {
  const actor = props.data.actors[props.actor]
  return (
    <td>
      <span className="name">
        <ActorIcon actor={actor} names={props.names} />
        <span className="ellipsis">{actorName(actor)}</span>
      </span>
    </td>
  )
}
function ActorRow(props: TableProps & { actor: number; cells: ReactNode; children: ReactNode }) {
  const open = props.open.has(props.actor)
  return (
    <Fragment>
      <tr
        className="actor"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => props.onOpen(flip(props.open, props.actor))}
        onKeyDown={(key) => {
          if (key.key !== 'Enter' && key.key !== ' ') return
          key.preventDefault()
          props.onOpen(flip(props.open, props.actor))
        }}
      >
        <ActorCell data={props.data} actor={props.actor} names={props.names} />
        {props.cells}
      </tr>
      {open && props.children}
    </Fragment>
  )
}
function SkillCell({ data, skill, suffix = '' }: { data: ReplayData; skill: string; suffix?: string }) {
  const label = `${skillLabel(data, skill)}${suffix}`
  return (
    <td title={label}>
      <span className="name">
        <SkillIcon skill={skill} />
        <span className="ellipsis">{label}</span>
      </span>
    </td>
  )
}
const Empty = ({ columns, text = '当前筛选下没有数据' }: { columns: number; text?: string }) => (
  <tr>
    <td className="empty" colSpan={columns}>
      {text}
    </td>
  </tr>
)
const Head = ({ columns }: { columns: string[] }) => (
  <thead>
    <tr>
      {columns.map((column) => (
        <th key={column}>{column}</th>
      ))}
    </tr>
  </thead>
)
const withShare = (value: number | null, share: number | null) => (
  <>
    {number(value)}
    {value !== null && share !== null && <span className="share"> ({percent(share * 100)})</span>}
  </>
)

export const DamageTable = memo(function DamageTable(props: TableProps & { rdps: boolean; rdpsReason: string | null }) {
  const rows = damageRows(props.data, props.scope, props.rdps)
  const rdpsCell = (value: number | null, share: number | null) =>
    props.rdps ? <td>{withShare(value, share)}</td> : <td title={props.rdpsReason ?? undefined}>{DASH}</td>
  return (
    <>
      <Toolbar scopeText={props.scopeText} />
      <table className="detail">
        <Head columns={['角色', 'DPS', 'rDPS', '总量', '暴击率', '直击率']} />
        <tbody>
          {rows.length === 0 && <Empty columns={6} />}
          {rows.map((row) => (
            <ActorRow
              key={row.actor}
              {...props}
              actor={row.actor}
              cells={
                <>
                  <td>{withShare(row.dps, row.dpsShare)}</td>
                  {rdpsCell(row.rdps, row.rdpsShare)}
                  <td>{amount(row.total)}</td>
                  <td>{rate(row.critRate)}</td>
                  <td>{rate(row.directRate)}</td>
                </>
              }
            >
              {row.skills.map((skill) => (
                <tr key={skill.skill} className="skill">
                  <SkillCell data={props.data} skill={skill.skill} suffix={skill.given ? '（给予队友）' : ''} />
                  <td>{skill.given ? DASH : number(skill.dps)}</td>
                  {props.rdps ? <td>{number(skill.rdps)}</td> : <td>{DASH}</td>}
                  <td>{skill.given ? DASH : amount(skill.total)}</td>
                  <td>{skill.given ? DASH : rate(skill.critRate)}</td>
                  <td>{skill.given ? DASH : rate(skill.directRate)}</td>
                </tr>
              ))}
            </ActorRow>
          ))}
        </tbody>
      </table>
    </>
  )
})

const TAKEN_GROUPS = [
  ['actor', '按角色'],
  ['skill', '按敌人技能'],
] as const
export const TakenTable = memo(function TakenTable(
  props: TableProps & { group: TakenGroup; onGroup: (group: TakenGroup) => void },
) {
  const byActor = props.group === 'actor' ? takenByActor(props.data, props.scope) : []
  const bySkill = props.group === 'skill' ? takenBySkill(props.data, props.scope) : []
  return (
    <>
      <Toolbar scopeText={props.scopeText}>
        <Segments label="承伤分组" value={props.group} options={TAKEN_GROUPS} onChange={props.onGroup} />
      </Toolbar>
      {props.group === 'actor' ? (
        <table className="detail">
          <Head columns={['角色', '每秒承伤', '总量', '死亡次数']} />
          <tbody>
            {byActor.length === 0 && <Empty columns={4} />}
            {byActor.map((row) => (
              <ActorRow
                key={row.actor}
                {...props}
                actor={row.actor}
                cells={
                  <>
                    <td>{number(row.perSecond)}</td>
                    <td>{amount(row.total)}</td>
                    <td>{row.deaths}</td>
                  </>
                }
              >
                {row.skills.map((skill) => (
                  <tr key={skill.skill} className="skill">
                    <SkillCell data={props.data} skill={skill.skill} />
                    <td />
                    <td>{amount(skill.total)}</td>
                    <td>{skill.hits} 次</td>
                  </tr>
                ))}
              </ActorRow>
            ))}
          </tbody>
        </table>
      ) : (
        <table className="detail">
          <Head columns={['技能', '总量', '占比', '命中次数', '受到伤害的角色']} />
          <tbody>
            {bySkill.length === 0 && <Empty columns={5} />}
            {bySkill.map((row) => (
              <tr key={row.skill}>
                <SkillCell data={props.data} skill={row.skill} />
                <td>{amount(row.total)}</td>
                <td>{rate(row.share)}</td>
                <td>{row.hits}</td>
                <td>
                  <Users data={props.data} actors={row.targets} names={props.names} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
})

function Users({ data, actors, names }: { data: ReplayData; actors: number[]; names: Record<string, string> }) {
  return (
    <span className="users">
      {actors.map((index) => (
        <span key={index} title={actorName(data.actors[index])}>
          <JobIcon job={data.actors[index].job} abbreviation={names[`job:${data.actors[index].job}`]} />
        </span>
      ))}
    </span>
  )
}

const HEAL_GROUPS = [
  ['actor', '按角色'],
  ['skill', '按技能'],
  ['target', '按目标'],
] as const
export const HealingTable = memo(function HealingTable(
  props: TableProps & { group: HealGroup; onGroup: (group: HealGroup) => void; overhealUnknown: ReadonlySet<number> },
) {
  let table: ReactNode
  if (props.group === 'actor') {
    const rows = healByActor(props.data, props.scope, props.overhealUnknown)
    table = (
      <table className="detail">
        <Head columns={['角色', 'HPS', '总量', '过量治疗率']} />
        <tbody>
          {rows.length === 0 && <Empty columns={4} />}
          {rows.map((row) => (
            <ActorRow
              key={row.actor}
              {...props}
              actor={row.actor}
              cells={
                <>
                  <td>{number(row.hps)}</td>
                  <td>{amount(row.total)}</td>
                  <td>{rate(row.overhealRate)}</td>
                </>
              }
            >
              {row.skills.map((skill) => (
                <tr key={skill.skill} className="skill">
                  <SkillCell data={props.data} skill={skill.skill} />
                  <td>{number(skill.hps)}</td>
                  <td>{amount(skill.total)}</td>
                  <td>{rate(skill.overhealRate)}</td>
                </tr>
              ))}
            </ActorRow>
          ))}
        </tbody>
      </table>
    )
  } else if (props.group === 'skill') {
    const rows = healBySkill(props.data, props.scope)
    table = (
      <table className="detail">
        <Head columns={['技能', '总量', '占比', '次数', '使用者']} />
        <tbody>
          {rows.length === 0 && <Empty columns={5} />}
          {rows.map((row) => (
            <tr key={row.skill}>
              <SkillCell data={props.data} skill={row.skill} />
              <td>{amount(row.total)}</td>
              <td>{rate(row.share)}</td>
              <td>{row.hits}</td>
              <td>
                <Users data={props.data} actors={row.users} names={props.names} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  } else {
    const rows = healByTarget(props.data, props.scope)
    table = (
      <table className="detail">
        <Head columns={['目标', '总量', '过量治疗率']} />
        <tbody>
          {rows.length === 0 && <Empty columns={3} />}
          {rows.map((row) => (
            <tr key={row.target}>
              {row.target < 0 ? (
                <td>未知目标</td>
              ) : (
                <ActorCell data={props.data} actor={row.target} names={props.names} />
              )}
              <td>{amount(row.total)}</td>
              <td title="过量治疗没有按目标记录">{DASH}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }
  return (
    <>
      <Toolbar scopeText={props.scopeText}>
        <Segments label="治疗分组" value={props.group} options={HEAL_GROUPS} onChange={props.onGroup} />
      </Toolbar>
      {table}
    </>
  )
})

/** Buffs or debuffs by actor; the line of the current time follows --now on an ancestor */
export const UptimeTable = memo(function UptimeTable(props: {
  data: ReplayData
  kind: 'buff' | 'debuff'
  chosen: ReadonlySet<number>
  span: { from: number; to: number }
  names: Record<string, string>
  open: ReadonlySet<number>
  onOpen: (open: ReadonlySet<number>) => void
}) {
  const { data } = props
  const groups = uptimeGroups(data, props.kind, props.chosen, props.span)
  const duration = data.fight.durationMs || 1
  if (!groups.length) return <p className="placeholder">当前筛选下没有状态</p>
  return (
    <div className="uptime-groups">
      {groups.map((group) => {
        const actor = data.actors[group.actor]
        const open = props.open.has(group.actor)
        return (
          <section key={group.actor} className="uptime-group">
            <div className="uptime-head">
              <span className="icon-slot">
                <ActorIcon actor={actor} names={props.names} />
              </span>
              <button
                type="button"
                className="uptime-toggle"
                aria-expanded={open}
                onClick={() => props.onOpen(flip(props.open, group.actor))}
              >
                <span className="ellipsis">{actorName(actor)}</span>
                <span className="uptime-meta">
                  {actor.kind === 'enemy' ? '敌人' : (props.names[`job:${actor.job}`] ?? '')} · {group.lines.length}{' '}
                  个状态
                </span>
                <span className="grow" />
                <span aria-hidden>{open ? '▾' : '▸'}</span>
              </button>
            </div>
            {open && (
              <table className="detail uptime">
                <Head columns={['状态', '来源', '覆盖率', '时间分布']} />
                <tbody>
                  {group.lines.map((line) => (
                    <tr key={line.statusId}>
                      <SkillCell data={data} skill={`status:${line.statusId}`} />
                      <td className="ellipsis" title={line.sources.join('、')}>
                        {line.sources.length ? line.sources.join('、') : DASH}
                      </td>
                      <td>{rate(line.uptime)}</td>
                      <td>
                        <span className="uptime-bar">
                          {line.intervals.map((interval) => (
                            <i
                              key={interval.from}
                              className={line.penalty ? 'span penalty' : 'span'}
                              style={{
                                left: `${(interval.from / duration) * 100}%`,
                                width: `${((interval.to - interval.from) / duration) * 100}%`,
                              }}
                            />
                          ))}
                          <b className="now" />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )
      })}
    </div>
  )
})
