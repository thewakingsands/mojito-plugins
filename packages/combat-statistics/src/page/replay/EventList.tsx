import { Check, Clapperboard, Skull, TriangleAlert, Zap } from 'lucide-react'
import { memo, type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import type { Hit, ReplayData, ReplayEvent, StatusNote } from '../../view-model.js'
import { amount, percent } from '../format.js'
import { SkillIcon } from '../icons.js'
import { type BossEvent, EVENT_TYPES, type EventType, isBossEvent, isFightEvent, lastBefore } from './events.js'
import { actionName, actorName, Diamond, sourceName, statusName } from './parts.js'
import { clockText } from './timeline.js'
import { poseAt } from './tracks.js'

const BOSS_TITLES = { bossIn: '首领出现', bossOut: '首领离开', bossDown: '首领被击败' } as const
const OUT_REASONS = { untargetable: '不可选中', left: '离开场地' } as const
const CUTSCENE_TITLES = { start: '过场动画开始', end: '过场动画结束' } as const
/** Not in a button of the base styles, which would size it */
const ICON = 14

/** The HP share of a boss right before the event, or when it came */
function bossHp(data: ReplayData, event: BossEvent) {
  const hp = poseAt(data.actors[event.actor].track, event.kind === 'bossIn' ? event.t : Math.max(0, event.t - 1))?.hp
  return hp === undefined || Number.isNaN(hp) ? null : hp
}
const hitText = (data: ReplayData, hit: Hit) =>
  `${sourceName(data, hit.source, hit.sourceName)} · ${hit.periodic ? statusName(data, hit.actionId ?? 0, hit.name) : actionName(data, hit.actionId, hit.name)}`
const hitShare = (hit: Hit, maxHp: number) => Math.round((hit.amount / maxHp) * 100)

/** The icon of an event, in the list and on the timeline */
export function EventIcon({ data, event }: { data: ReplayData; event: ReplayEvent }) {
  switch (event.kind) {
    case 'cutscene':
      return (
        <span className="event-icon muted">
          <Clapperboard size={ICON} />
        </span>
      )
    case 'death':
      return (
        <span className="event-icon danger">
          <Skull size={ICON} />
        </span>
      )
    case 'penalty':
      return (
        <SkillIcon
          skill={`status:${event.statusId}`}
          fallback={
            <span className="event-icon warn">
              <TriangleAlert size={ICON} />
            </span>
          }
        />
      )
    case 'bigHit':
      return (
        <span className="event-icon warn">
          <Zap size={ICON} />
        </span>
      )
    case 'bossDown':
      return (
        <span className="event-icon accent">
          <Check size={ICON} />
        </span>
      )
    default:
      return (
        <span className="event-icon">
          <Diamond main={data.actors[event.actor]?.main ?? false} hollow={event.kind === 'bossOut'} size={ICON} />
        </span>
      )
  }
}

/** The first line and the second line of an event in the list; the second starts with its number */
export function eventLines(data: ReplayData, event: ReplayEvent): { title: string; detail: string } {
  if (event.kind === 'cutscene') return { title: CUTSCENE_TITLES[event.edge], detail: '' }
  const who = actorName(data.actors[event.actor])
  switch (event.kind) {
    case 'death':
      return {
        title: `死亡 · ${who}`,
        detail: event.killingBlow
          ? `${amount(event.killingBlow.amount)} · ${hitText(data, event.killingBlow)}`
          : '致命一击未知',
      }
    case 'penalty':
      return {
        title: `${statusName(data, event.statusId, event.name)} · ${who}`,
        detail: [
          `来自 ${sourceName(data, event.cause.source, event.cause.sourceName)}`,
          event.cause.actionId !== null && actionName(data, event.cause.actionId, event.cause.name),
          event.durationMs !== null && `${Math.round(event.durationMs / 1000)} 秒`,
          event.stacks !== null && `${event.stacks} 层`,
        ]
          .filter(Boolean)
          .join(' · '),
      }
    case 'bigHit':
      return {
        title: `大额伤害 · ${who}`,
        detail: `${amount(event.hit.amount)}（最大 HP 的 ${hitShare(event.hit, event.maxHp)}%）· ${hitText(data, event.hit)}`,
      }
    default: {
      const hp = bossHp(data, event)
      const hpText = hp === null ? '' : `HP ${percent(hp * 100)}`
      return {
        title: `${BOSS_TITLES[event.kind]} · ${who}`,
        detail:
          event.kind === 'bossIn'
            ? hpText
            : event.kind === 'bossOut'
              ? `${OUT_REASONS[event.reason]}${hp === null ? '' : ` · ${hpText}`}`
              : '',
      }
    }
  }
}

/**
 * The switches of the event types over the listed events, the ones after the time dimmed. While playing it keeps the
 * last event before the time in view, until the user scrolls the list; a click on an event or a drag of the timeline
 * gives it back. The expanded event shows its details under it.
 */
export const EventList = memo(function EventList(props: {
  data: ReplayData
  events: readonly ReplayEvent[]
  /** How many events of each type the members and the span leave, whether the type is on or not */
  counts: Record<EventType, number>
  types: ReadonlySet<EventType>
  onTypes: (types: ReadonlySet<EventType>) => void
  time: number
  playing: boolean
  expanded: ReplayEvent | null
  /** Changes whenever the user moves the time; the list follows again then */
  follow: number
  onSelect: (event: ReplayEvent) => void
}) {
  const { data, events, time, types } = props
  const list = useRef<HTMLDivElement>(null)
  const [manual, setManual] = useState(false)
  const last = lastBefore(events, time)
  const [followed, setFollowed] = useState(props.follow)
  if (followed !== props.follow) {
    setFollowed(props.follow)
    setManual(false)
  }
  useLayoutEffect(() => {
    if (!props.playing || manual || last < 0) return
    const item = list.current?.children[last] as HTMLElement | undefined
    item?.scrollIntoView?.({ block: 'nearest' })
  }, [props.playing, manual, last])
  // As much of the details in view as fits, and the event itself always
  useLayoutEffect(() => {
    const item = props.expanded && list.current?.querySelector('.event-item.open')
    if (!item) return
    item.scrollIntoView?.({ block: 'nearest' })
    item.querySelector('.event')?.scrollIntoView?.({ block: 'nearest' })
  }, [props.expanded])
  const toggle = (type: EventType) => {
    const next = new Set(types)
    if (!next.delete(type)) next.add(type)
    props.onTypes(next)
  }
  return (
    <>
      <div className="event-types">
        {EVENT_TYPES.map(([type, label]) => (
          <label key={type}>
            <input type="checkbox" checked={types.has(type)} onChange={() => toggle(type)} />
            {label}
            <span className="number">{props.counts[type]}</span>
          </label>
        ))}
      </div>
      {!types.size ? (
        <p className="placeholder">没有选中任何事件类型</p>
      ) : !events.length ? (
        <p className="placeholder">当前筛选下没有重要事件</p>
      ) : (
        <div className="events" ref={list} onWheel={() => setManual(true)}>
          {events.map((event, index) => {
            const lines = eventLines(data, event)
            const open = props.expanded === event
            const classes = ['event', isFightEvent(event) && 'boss', event.t > time && 'future']
            return (
              <div key={`${event.kind}:${event.t}:${index}`} className={`event-item${open ? ' open' : ''}`}>
                <button
                  type="button"
                  className={classes.filter(Boolean).join(' ')}
                  aria-expanded={open}
                  data-event
                  onClick={() => props.onSelect(event)}
                >
                  <span className="event-time number">{clockText(event.t)}</span>
                  <EventIcon data={data} event={event} />
                  <span className="event-text">
                    <span className="ellipsis">{lines.title}</span>
                    {lines.detail && <small>{lines.detail}</small>}
                  </span>
                </button>
                {open && <EventDetail data={data} event={event} />}
              </div>
            )
          })}
        </div>
      )}
    </>
  )
})

function Statuses({ data, title, statuses }: { data: ReplayData; title: string; statuses: StatusNote[] }) {
  return (
    <>
      <h5>{title}</h5>
      {statuses.length ? (
        <div className="popover-chips">
          {statuses.map((status) => (
            <span key={`${status.statusId}:${status.since}`} title={`开始于 ${clockText(status.since)}`}>
              <SkillIcon skill={`status:${status.statusId}`} />
              {statusName(data, status.statusId, status.name)}
            </span>
          ))}
        </div>
      ) : (
        <p className="popover-none">无</p>
      )}
    </>
  )
}

/** What an event did and why, under it in the list */
function EventDetail(props: { data: ReplayData; event: ReplayEvent }) {
  const { data, event } = props
  let body: ReactNode
  switch (event.kind) {
    case 'cutscene':
      body = (
        <p>
          {clockText(event.from)} – {clockText(event.to)} · {((event.to - event.from) / 1000).toFixed(1)} 秒
        </p>
      )
      break
    case 'death':
      body = (
        <>
          <h5>死亡前 10 秒受到的伤害{event.maxHp === null ? '' : `（最大 HP ${amount(event.maxHp)}）`}</h5>
          <table className="hits">
            <tbody>
              {event.recentHits.map((hit, index) => (
                <tr key={index}>
                  <td className="number">{clockText(hit.t)}</td>
                  <td>
                    {hitText(data, hit)}
                    {hit.periodic && '（持续伤害）'}
                  </td>
                  <td className="number">{amount(hit.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Statuses data={data} title="死亡时身上的状态" statuses={event.statuses} />
        </>
      )
      break
    case 'penalty':
      body = (
        <>
          <p>
            来自：{sourceName(data, event.cause.source, event.cause.sourceName)}
            {event.cause.actionId !== null && ` · ${actionName(data, event.cause.actionId, event.cause.name)}`}
          </p>
          <p>
            {event.durationMs === null ? '持续时间未知' : `${Math.round(event.durationMs / 1000)} 秒`}
            {event.stacks !== null && ` · ${event.stacks} 层`}
          </p>
        </>
      )
      break
    case 'bigHit':
      body = (
        <>
          <p>
            {hitText(data, event.hit)} {amount(event.hit.amount)}
          </p>
          <p>最大 HP 的 {hitShare(event.hit, event.maxHp)}%</p>
          <Statuses data={data} title="当时身上的状态" statuses={event.statuses} />
        </>
      )
      break
    default: {
      const hp = bossHp(data, event)
      body = (
        <>
          {hp !== null && <p>HP {percent(hp * 100)}</p>}
          <h5>这个首领在本场的出现和离开</h5>
          <table className="hits">
            <tbody>
              {data.events
                .filter((item): item is BossEvent => isBossEvent(item) && item.actor === event.actor)
                .map((item, index) => (
                  <tr key={index}>
                    <td className="number">{clockText(item.t)}</td>
                    <td>
                      {BOSS_TITLES[item.kind]}
                      {item.kind === 'bossOut' && `（${OUT_REASONS[item.reason]}）`}
                    </td>
                    <td />
                  </tr>
                ))}
            </tbody>
          </table>
        </>
      )
    }
  }
  return (
    <section className="event-detail" aria-label="事件详情">
      {body}
    </section>
  )
}
