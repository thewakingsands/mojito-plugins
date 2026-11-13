import { ChevronsDown, ChevronsUp, Pause, Play } from 'lucide-react'
import { memo, type ReactNode, type PointerEvent as ReactPointerEvent, useId, useMemo, useRef, useState } from 'react'
import type { ReplayAction, ReplayData, ReplayEvent } from '../../view-model.js'
import { duration as tickText } from '../format.js'
import { JobIcon, SkillIcon } from '../icons.js'
import type { Span } from './aggregate.js'
import { DpsLabel, DpsLane, PotencyLabel, PotencyLane, useCurves } from './CurveLanes.js'
import { EventIcon, eventLines } from './EventList.js'
import { cutscenesOf, isFightEvent } from './events.js'
import { FloatingTip } from './FloatingTip.js'
import type { FilterMember } from './filter.js'
import { Help } from './Help.js'
import { actionName, actorName, ROLE_CLASS } from './parts.js'
import { useSize } from './ReplayMap.js'
import { castLabelShown, clockText, ICON_WINDOW_MS, pressed, ticks, ZOOMS, type Zoom } from './timeline.js'

const ROLE_ORDER = { tank: 0, healer: 1, dps: 2 } as const

interface Use {
  /** Index into ReplayData.uses, the key that keeps an element on its use while the window moves */
  index: number
  t: number
  actor: number
  action: ReplayAction
}
/** The uses of the data with their actions */
export function usesOf(data: ReplayData): Use[] {
  const uses: Use[] = []
  for (let i = 0; i < data.uses.t.length; i++)
    uses.push({ index: i, t: data.uses.t[i], actor: data.uses.actor[i], action: data.actions[data.uses.action[i]] })
  return uses
}

export function PlaybackControls(props: {
  time: number
  durationMs: number
  playing: boolean
  speed: number
  zoom: Zoom
  expanded: boolean
  onPlay: () => void
  onSpeed: () => void
  onZoom: (zoom: Zoom) => void
  onExpand: () => void
}) {
  const speedTip = useId()
  return (
    <div className="playback">
      <button type="button" data-variant="primary" onClick={props.onPlay}>
        {props.playing ? <Pause /> : <Play />}
        {props.playing ? '暂停' : '播放'}
      </button>
      <button type="button" aria-label={`播放速度 ${props.speed}×`} interestfor={speedTip} onClick={props.onSpeed}>
        {props.speed}×
      </button>
      <span id={speedTip} popover="hint">
        播放速度
      </span>
      <span className="number clock">
        {clockText(props.time)} / {clockText(props.durationMs)}
      </span>
      <span className="grow" />
      <span className="playback-label">缩放</span>
      <fieldset className="mojito-segmented" aria-label="缩放">
        {ZOOMS.map((zoom) => (
          <button
            key={zoom.label}
            type="button"
            aria-pressed={props.zoom === zoom.ms}
            onClick={() => props.onZoom(zoom.ms)}
          >
            {zoom.label}
          </button>
        ))}
      </fieldset>
      <button type="button" aria-expanded={props.expanded} onClick={props.onExpand}>
        {props.expanded ? <ChevronsDown /> : <ChevronsUp />}
        技能轴
      </button>
      <Help />
    </div>
  )
}

const markClass = (event: ReplayEvent) => (event.kind === 'death' ? 'danger' : isFightEvent(event) ? 'accent' : 'warn')

/** The whole fight in one strip: event marks, the playhead and the window of a zoom */
export function OverviewStrip(props: {
  durationMs: number
  time: number
  window: Span
  zoomed: boolean
  events: readonly ReplayEvent[]
  onPick: (time: number) => void
}) {
  const share = (t: number) => `${(t / (props.durationMs || 1)) * 100}%`
  return (
    <div
      className="overview-strip"
      onPointerDown={(down) => {
        const rect = down.currentTarget.getBoundingClientRect()
        props.onPick(((down.clientX - rect.left) / (rect.width || 1)) * props.durationMs)
      }}
    >
      {props.events.map((event, index) => (
        <i key={index} className={`mark ${markClass(event)}`} style={{ left: share(event.t) }} />
      ))}
      {props.zoomed && (
        <span
          className="window"
          style={{ left: share(props.window.from), width: share(props.window.to - props.window.from) }}
        />
      )}
      <b className="head" style={{ left: share(props.time) }} />
    </div>
  )
}

interface LaneProps {
  data: ReplayData
  window: Span
  chosen: ReadonlySet<number>
  events: readonly ReplayEvent[]
  uses: readonly Use[]
  expanded: boolean
  names: Record<string, string>
  selection: Span | null
  onSeek: (time: number) => void
  onSelectSpan: (span: Span) => void
  onEvent: (event: ReplayEvent, item: HTMLElement) => void
  /** The index in ReplayData.casts of the cast whose details are open */
  openCast: number | null
  onCast: (index: number, item: HTMLElement) => void
  onScroll: (by: number) => void
  /** The members in the order of the filter bar */
  members: readonly FilterMember[]
  mergePets: boolean
}

/** The row of ticks; with nothing selected, a tip at the pointer says that a drag on it selects a span */
function Ruler(props: { onPress: (down: ReactPointerEvent<HTMLElement>) => void; hint: boolean; children: ReactNode }) {
  const [pointer, setPointer] = useState<{ x: number; top: number; bottom: number } | null>(null)
  return (
    <div
      className="lane ruler"
      onPointerDown={(down) => {
        setPointer(null)
        props.onPress(down)
      }}
      onPointerMove={(move) => {
        if (move.buttons) return
        const rect = move.currentTarget.getBoundingClientRect()
        setPointer({ x: move.clientX, top: rect.top, bottom: rect.bottom })
      }}
      onPointerLeave={() => setPointer(null)}
    >
      {props.children}
      {props.hint && pointer && (
        <FloatingTip
          side="below"
          className="ruler-tip"
          anchor={{ left: pointer.x, right: pointer.x, top: pointer.top, bottom: pointer.bottom }}
        >
          拖动选取时间段
        </FloatingTip>
      )}
    </div>
  )
}

/**
 * The rows of the timeline. They redraw when the data, the filter or the window change, never for the playhead,
 * which is drawn over them.
 */
const Lanes = memo(function Lanes(props: LaneProps & { width: number }) {
  const { data, window, width } = props
  const length = window.to - window.from || 1
  const x = (t: number) => ((t - window.from) / length) * width
  const visible = (from: number, to: number) => to >= window.from && from <= window.to
  const icons = length <= ICON_WINDOW_MS
  const members = data.actors
    .filter((actor) => actor.kind === 'member' && props.chosen.has(actor.index))
    .sort((a, b) => (a.role ? ROLE_ORDER[a.role] : 3) - (b.role ? ROLE_ORDER[b.role] : 3) || a.index - b.index)
  const main = data.actors.find((actor) => actor.main)

  /** A press seeks there and drags the time along until it is released */
  const seek = (down: ReactPointerEvent<HTMLElement>) => {
    const rect = down.currentTarget.getBoundingClientRect()
    const at = (clientX: number) => window.from + ((clientX - rect.left) / (rect.width || 1)) * length
    props.onSeek(at(down.clientX))
    const move = (event: PointerEvent) => props.onSeek(at(event.clientX))
    const up = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
  }
  const [preview, setPreview] = useState<Span | null>(null)
  const ruler = (down: ReactPointerEvent<HTMLElement>) => {
    const rect = down.currentTarget.getBoundingClientRect()
    const at = (clientX: number) => window.from + ((clientX - rect.left) / (rect.width || 1)) * length
    const start = down.clientX
    const move = (event: PointerEvent) => {
      const result = pressed(at(start), at(event.clientX), event.clientX - start)
      setPreview(result.kind === 'select' ? result.span : null)
    }
    const up = (event: PointerEvent) => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      setPreview(null)
      const result = pressed(at(start), at(event.clientX), event.clientX - start)
      if (result.kind === 'click') props.onSeek(result.time)
      else props.onSelectSpan(result.span)
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
  }
  const shade = preview ?? props.selection
  const curves = useCurves(data, props.chosen, props.members, props.mergePets)
  // In every lane and first, so that a press on them is one on the lane and what the lane holds is drawn over them
  const cutscenes = cutscenesOf(data.events)
    .filter((cutscene) => visible(cutscene.from, cutscene.to))
    .map((cutscene) => (
      <span
        key={`cutscene:${cutscene.from}`}
        className="cutscene"
        style={{ left: x(cutscene.from), width: x(cutscene.to) - x(cutscene.from) }}
        title={`过场动画 ${clockText(cutscene.from)} – ${clockText(cutscene.to)}`}
      />
    ))
  const curveProps = {
    data,
    window,
    width,
    chosen: props.chosen,
    members: props.members,
    curves,
    onPress: ruler,
    shades: cutscenes,
  }
  const lane = (key: string, className: string, children: React.ReactNode) => (
    <div key={key} className={`lane ${className}`} onPointerDown={seek}>
      {cutscenes}
      {children}
    </div>
  )
  const laneUses = (kind: 'buff' | 'mitigation') => {
    const uses = props.uses
      .filter((use) => use.action.lane === kind && props.chosen.has(use.actor))
      .filter((use) => visible(use.t, use.t + (use.action.durationMs ?? 0)))
      // The sustained first, so that the others are drawn over them
      .sort((a, b) => Number(b.action.sustained) - Number(a.action.sustained))
      .map((use) => ({
        use,
        title: `${actionName(data, use.action.actionId, use.action.name)} · ${actorName(data.actors[use.actor])} · 持续 ${Math.round((use.action.durationMs ?? 0) / 1000)} 秒`,
      }))
    // Every bar before the first icon, so that no bar covers the icon of another use. Past two minutes there are no
    // icons: the bars alone show when the raid is covered.
    return (
      <>
        {uses.map(({ use, title }) => {
          const role = data.actors[use.actor].role
          return (
            <i
              key={use.index}
              className={`lane-bar${role ? ` ${ROLE_CLASS[role]}` : ''}${use.action.sustained ? ' sustained' : ''}`}
              style={{ left: x(use.t), width: Math.max(0, x(use.t + (use.action.durationMs ?? 0)) - x(use.t)) }}
              title={title}
            />
          )
        })}
        {icons &&
          uses.map(({ use, title }) => (
            <span key={use.index} className="lane-use" style={{ left: x(use.t) }} title={title}>
              <SkillIcon skill={`action:${use.action.actionId}`} />
            </span>
          ))}
      </>
    )
  }
  return (
    <div
      className={`lanes${icons ? '' : ' dense'}`}
      onWheel={(wheel) => props.onScroll(Math.sign(wheel.deltaY || wheel.deltaX) * length * 0.1)}
    >
      <div className="labels">
        <span className="label" />
        {props.expanded && (
          <>
            <DpsLabel />
            <PotencyLabel data={data} curves={curves} names={props.names} />
          </>
        )}
        <span className="label">敌人读条</span>
        <span className="label">团辅</span>
        <span className="label">团队减伤</span>
        <span className="label">事件</span>
        {props.expanded &&
          members.map((actor) => (
            <span key={actor.index} className="label member">
              <JobIcon job={actor.job} abbreviation={props.names[`job:${actor.job}`]} />
              <span className="ellipsis">{actorName(actor)}</span>
            </span>
          ))}
      </div>
      <div className="rows">
        {shade && <span className="selection" style={{ left: x(shade.from), width: x(shade.to) - x(shade.from) }} />}
        <Ruler onPress={ruler} hint={!shade}>
          {cutscenes}
          {ticks(window).map((t) => (
            <span key={t} className="tick" style={{ left: x(t) }}>
              {tickText(t)}
            </span>
          ))}
        </Ruler>
        {props.expanded && (
          <>
            <DpsLane {...curveProps} />
            <PotencyLane {...curveProps} />
          </>
        )}
        {lane(
          'casts',
          'casts',
          data.casts
            .map((cast, index) => ({ cast, index }))
            .filter(({ cast }) => cast.actor === main?.index && visible(cast.t, cast.t + cast.durationMs))
            .map(({ cast, index }) => {
              const end = cast.cancelledAt ?? cast.t + cast.durationMs
              const name = actionName(data, cast.actionId, cast.name)
              const classes = ['cast', cast.cancelledAt !== null && 'cancelled', props.openCast === index && 'open']
              const barWidth = Math.max(2, x(end) - x(cast.t))
              return (
                <button
                  key={index}
                  type="button"
                  className={classes.filter(Boolean).join(' ')}
                  data-cast
                  aria-label={name}
                  style={{ left: x(cast.t), width: barWidth }}
                  title={`${name} · 读条 ${(cast.durationMs / 1000).toFixed(1)} 秒${cast.cancelledAt !== null ? ' · 被打断或取消' : ''}`}
                  onPointerDown={(down) => down.stopPropagation()}
                  onClick={(click) => props.onCast(index, click.currentTarget)}
                >
                  {castLabelShown(barWidth, name) && name}
                </button>
              )
            }),
        )}
        {lane('buff', 'buff', laneUses('buff'))}
        {lane('mitigation', 'mitigation', laneUses('mitigation'))}
        {lane(
          'events',
          'events',
          props.events
            .map((event, index) => ({ event, index }))
            .filter(({ event }) => visible(event.t, event.t))
            .map(({ event, index }) => {
              const lines = eventLines(data, event)
              return (
                <button
                  key={index}
                  type="button"
                  className="event-mark"
                  style={{ left: x(event.t) }}
                  title={`${clockText(event.t)} ${lines.title}`}
                  onPointerDown={(down) => down.stopPropagation()}
                  onClick={(click) => props.onEvent(event, click.currentTarget)}
                >
                  <EventIcon data={data} event={event} />
                </button>
              )
            }),
        )}
        {props.expanded &&
          members.map((actor) =>
            lane(
              `member:${actor.index}`,
              'member',
              <>
                {data.casts
                  .map((cast, index) => ({ cast, index }))
                  .filter(({ cast }) => cast.actor === actor.index && visible(cast.t, cast.t + cast.durationMs))
                  .map(({ cast, index }) => (
                    <i
                      key={`cast:${index}`}
                      className="cast-bar"
                      style={{
                        left: x(cast.t),
                        width: Math.max(1, x(cast.cancelledAt ?? cast.t + cast.durationMs) - x(cast.t)),
                      }}
                    />
                  ))}
                {props.uses
                  // Past two minutes the weaponskills and spells are a solid band; the abilities still stand out
                  .filter(
                    (use) =>
                      use.actor === actor.index &&
                      visible(use.t, use.t) &&
                      use.action.name &&
                      (icons || !use.action.gcd),
                  )
                  .map((use) => {
                    const lasting = use.action.lane && use.action.durationMs
                    const title = `${clockText(use.t)} ${use.action.name}${lasting ? ` · 持续 ${Math.round(lasting / 1000)} 秒` : ''}`
                    const row = use.action.gcd ? 'gcd' : 'ability'
                    return icons ? (
                      <span key={`use:${use.index}`} className={`use ${row}`} style={{ left: x(use.t) }} title={title}>
                        <SkillIcon skill={`action:${use.action.actionId}`} />
                      </span>
                    ) : (
                      <i
                        key={`use:${use.index}`}
                        className={`use-line ${row} ${actor.role && !use.action.gcd ? ROLE_CLASS[actor.role] : ''}`}
                        style={{ left: x(use.t) }}
                        title={title}
                      />
                    )
                  })}
              </>,
            ),
          )}
      </div>
    </div>
  )
})

/** The rows with the playhead drawn over them */
export function Timeline(props: LaneProps & { time: number }) {
  const { time, ...lanes } = props
  const rows = useRef<HTMLDivElement>(null)
  const { width } = useSize(rows)
  const length = props.window.to - props.window.from || 1
  const left = ((time - props.window.from) / length) * width
  // The ruler and the rows share the width of the column right of the labels.
  const measured = useMemo(() => Math.max(0, width), [width])
  return (
    <div className="timeline-body">
      <div className="timeline-measure" ref={rows} />
      <Lanes {...lanes} width={measured} />
      {time >= props.window.from && time <= props.window.to && (
        <b className="playhead" style={{ transform: `translateX(${left}px)` }} />
      )}
    </div>
  )
}
