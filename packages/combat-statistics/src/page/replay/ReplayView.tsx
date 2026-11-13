import { ArrowLeft, Map as MapIcon, PanelRightClose, PanelRightOpen, X } from 'lucide-react'
import {
  type CSSProperties,
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReplayData, ReplayEvent, ReplayResult, StatisticsState, VisitView } from '../../view-model.js'
import { useBridge } from '../bridge.js'
import { fightFacts, ResultLabel } from '../fight.js'
import { duration, entered, percent, zoneName } from '../format.js'
import type { Scope, Span } from './aggregate.js'
import { CastPopover } from './CastPopover.js'
import { DamageTable, type HealGroup, HealingTable, type TakenGroup, TakenTable, UptimeTable } from './DetailTables.js'
import { EventList } from './EventList.js'
import { countTypes, DEFAULT_TYPES, type EventType, listedEvents, ofTypes } from './events.js'
import { everyone, type FilterMember, isEveryone } from './filter.js'
import { bottomHeight, bottomLimit, panelWidth } from './layout.js'
import { MemberFilter } from './MemberFilter.js'
import { PanelMeasure } from './PanelMeasure.js'
import { type Clock, nextSpeed, play, playhead } from './playback.js'
import { ReplayMap, useSize } from './ReplayMap.js'
import { OverviewStrip, PlaybackControls, Timeline, usesOf } from './ReplayTimeline.js'
import { clockText, follow, scrollWindow, windowAround, type Zoom } from './timeline.js'

type Tab = 'events' | 'damage' | 'taken' | 'healing' | 'buff' | 'debuff'
const TABS: [Tab, string][] = [
  ['events', '重要事件'],
  ['damage', '伤害'],
  ['taken', '承伤'],
  ['healing', '治疗'],
  ['buff', 'Buff'],
  ['debuff', 'Debuff'],
]
const ROLE_ORDER = { tank: 0, healer: 1, dps: 2 } as const
const STEP_MS = 5000
const POPOVER_GAP = 8
/** The width of .popover in style.css */
const POPOVER_WIDTH = 320

/** Calls move for each move of the pointer after a press, until it is released */
function drag(move: (event: PointerEvent) => void) {
  const up = () => {
    document.removeEventListener('pointermove', move)
    document.removeEventListener('pointerup', up)
  }
  document.addEventListener('pointermove', move)
  document.addEventListener('pointerup', up)
}

/** The review of one ended fight; it loads its data from the worker when it opens. */
export function ReplayView(props: {
  visitId: string
  fightId: string
  statistics: StatisticsState | null
  visit: VisitView | undefined
  onBack: () => void
}) {
  const { command } = useBridge()
  const [result, setResult] = useState<ReplayResult | null>(null)
  useEffect(() => {
    let live = true
    setResult(null)
    command({ kind: 'replay', visitId: props.visitId, fightId: props.fightId }).then(
      (value) => {
        if (live) setResult(value as unknown as ReplayResult)
      },
      (error: unknown) => {
        if (live) setResult({ ok: false, reason: error instanceof Error ? error.message : String(error) })
      },
    )
    return () => {
      live = false
    }
  }, [command, props.visitId, props.fightId])
  const { visitId: _, ...head } = props
  if (result?.ok) return <Review data={result.data} statistics={props.statistics} head={head} />
  return (
    <div className="replay">
      <ReplayHeader {...head} />
      {result ? (
        <p className="mojito-callout replay-message" data-tone="danger">
          无法打开这场战斗的回顾：{result.reason}
        </p>
      ) : (
        <p className="mojito-empty">正在读取日志</p>
      )}
    </div>
  )
}

interface HeadProps {
  fightId: string
  statistics: StatisticsState | null
  visit: VisitView | undefined
  onBack: () => void
}

/** One line: back, the fight and its result, what is known of it, then the controls of the review on the right */
function ReplayHeader(props: HeadProps & { children?: ReactNode }) {
  const back = useId()
  const fight = props.visit?.fights.find((item) => item.id === props.fightId)
  const facts = fight && fightFacts(fight, props.statistics)
  const summary = props.statistics?.selected?.id === props.fightId ? props.statistics.selected : null
  const mainEnemy = summary?.outcome.mainEnemy ?? fight?.mainEnemy
  const subtitle = [
    props.visit && zoneName(props.visit),
    summary && entered(summary.startAt, Date.now()),
    facts && duration(facts.durationMs),
    facts?.result === 'wipe' && mainEnemy?.hpPercent != null && `敌人剩余 ${percent(mainEnemy.hpPercent)}`,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <header className="replay-head">
      <button
        type="button"
        data-icon
        data-variant="ghost"
        aria-label="返回概览"
        interestfor={back}
        onClick={props.onBack}
      >
        <ArrowLeft />
      </button>
      <span id={back} popover="hint">
        返回概览
      </span>
      <h1 className="replay-title">
        {fight && <span className="number">#{fight.number}</span>} {facts?.enemy ?? '未知敌人'}
      </h1>
      {facts && <ResultLabel result={facts.result} />}
      <span className="subtitle ellipsis" title={subtitle}>
        {subtitle}
      </span>
      <span className="grow" />
      {props.children}
    </header>
  )
}

/** The span the review is limited to, with a button that clears it */
function SpanLabel({ span, onClear }: { span: Span; onClear: () => void }) {
  return (
    <span className="span-label number">
      {clockText(span.from)} – {clockText(span.to)}（{((span.to - span.from) / 1000).toFixed(1)} 秒）
      <button type="button" data-icon data-variant="ghost" aria-label="清除时间段" onClick={onClear}>
        <X />
      </button>
    </span>
  )
}

/** The page once its data is there */
const Review = memo(function Review({
  data,
  statistics,
  head,
}: {
  data: ReplayData
  statistics: StatisticsState | null
  head: HeadProps
}) {
  const durationMs = data.fight.durationMs
  const names = statistics?.names ?? {}
  const summary = statistics?.selected?.id === data.fight.fightId ? statistics.selected : null
  const members = useMemo<FilterMember[]>(
    () =>
      data.actors
        .filter((actor) => actor.kind === 'member')
        .sort((a, b) => (a.role ? ROLE_ORDER[a.role] : 3) - (b.role ? ROLE_ORDER[b.role] : 3) || a.index - b.index)
        .map((actor) => ({ index: actor.index, role: actor.role })),
    [data],
  )
  const uses = useMemo(() => usesOf(data), [data])

  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const clock = useRef<Clock | null>(null)
  const [chosen, setChosen] = useState<ReadonlySet<number>>(() => everyone(members))
  const [span, setSpan] = useState<Span | null>(null)
  const [zoom, setZoom] = useState<Zoom>(null)
  const [window, setWindow] = useState<Span>({ from: 0, to: durationMs })
  const [expanded, setExpanded] = useState(false)
  const [tab, setTab] = useState<Tab>('events')
  const [takenGroup, setTakenGroup] = useState<TakenGroup>('actor')
  const [healGroup, setHealGroup] = useState<HealGroup>('actor')
  const [damageOpen, setDamageOpen] = useState<ReadonlySet<number>>(new Set())
  const [takenOpen, setTakenOpen] = useState<ReadonlySet<number>>(new Set())
  const [healOpen, setHealOpen] = useState<ReadonlySet<number>>(new Set())
  const [buffOpen, setBuffOpen] = useState<ReadonlySet<number>>(new Set())
  const [debuffOpen, setDebuffOpen] = useState<ReadonlySet<number>>(new Set())
  const [expandedEvent, setExpandedEvent] = useState<ReplayEvent | null>(null)
  const [types, setTypes] = useState<ReadonlySet<EventType>>(DEFAULT_TYPES)
  /** The cast of the timeline whose details are open, and where they show */
  const [castOpen, setCastOpen] = useState<{ index: number; left: number; bottom: number } | null>(null)
  const [timelineOpen, setTimelineOpen] = useState(false)
  // The sizes the user dragged the panels to; they last as long as this review is open
  const [panelDragged, setPanelDragged] = useState<number | null>(null)
  /** The width the expanded panel needs for its widest table, measured for one filter */
  const [fitted, setFitted] = useState<{ scope: Scope; width: number } | null>(null)
  const [bottomDragged, setBottomDragged] = useState<number | null>(null)
  const [showNames, setShowNames] = useState(false)
  const [mapHidden, setMapHidden] = useState(false)
  const showMapTip = useId()
  /** Bumped when the user moves the time, so the event list follows the playhead again */
  const [moved, setMoved] = useState(0)

  const main = useRef<HTMLDivElement>(null)
  const middle = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLElement>(null)
  const measure = useRef<HTMLDivElement>(null)
  const bottomPanel = useRef<HTMLElement>(null)
  const popover = useRef<HTMLDivElement>(null)
  const mainSize = useSize(main)
  const middleSize = useSize(middle)

  const pause = useCallback(() => {
    clock.current = null
    setPlaying(false)
  }, [])
  const seek = useCallback(
    (to: number) => {
      const next = Math.min(durationMs, Math.max(0, to))
      pause()
      setTime(next)
      setMoved((count) => count + 1)
      setWindow((current) =>
        next < current.from || next > current.to ? windowAround(next, current.to - current.from, durationMs) : current,
      )
    },
    [durationMs, pause],
  )
  const togglePlay = useCallback(() => {
    if (clock.current) {
      pause()
      return
    }
    clock.current = play(time, durationMs, performance.now(), speed)
    if (time >= durationMs) setTime(0)
    setPlaying(true)
  }, [time, durationMs, speed, pause])
  useEffect(() => {
    if (!playing) return
    let frame = 0
    const step = () => {
      const current = clock.current
      if (!current) return
      const head = playhead(current, performance.now(), durationMs)
      setTime(head.time)
      setWindow((window) => follow(window, head.time, durationMs))
      if (head.ended) {
        clock.current = null
        setPlaying(false)
        return
      }
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [playing, durationMs])
  const changeSpeed = () => {
    const next = nextSpeed(speed)
    setSpeed(next)
    if (clock.current) clock.current = play(time, durationMs, performance.now(), next)
  }
  const changeZoom = (next: Zoom) => {
    setZoom(next)
    setWindow(windowAround(time, next, durationMs))
  }
  /** The arrow keys move the time and keep playing */
  const step = useCallback(
    (by: number) => {
      const next = Math.min(durationMs, Math.max(0, time + by))
      setTime(next)
      setMoved((count) => count + 1)
      setWindow((current) => follow(current, next, durationMs))
      if (clock.current) clock.current = play(next, durationMs, performance.now(), clock.current.speed)
    },
    [time, durationMs],
  )

  const closeCast = useCallback(() => setCastOpen(null), [])
  /** Moves to the event and expands it in the list, or collapses it when it is expanded */
  const selectEvent = useCallback(
    (event: ReplayEvent) => {
      setCastOpen(null)
      if (expandedEvent === event) {
        setExpandedEvent(null)
        return
      }
      seek(event.t)
      setTab('events')
      setExpandedEvent(event)
    },
    [expandedEvent, seek],
  )
  /** Opens the details of a cast above its bar, or closes them when they are open; the time stays where it is */
  const openCast = useCallback(
    (index: number, item: HTMLElement) => {
      if (castOpen?.index === index) {
        setCastOpen(null)
        return
      }
      const box = item.getBoundingClientRect()
      const { clientWidth, clientHeight } = document.documentElement
      setCastOpen({
        index,
        left: Math.max(POPOVER_GAP, Math.min(box.left, clientWidth - POPOVER_WIDTH - POPOVER_GAP)),
        bottom: clientHeight - box.top + POPOVER_GAP,
      })
    },
    [castOpen],
  )
  // A press outside the details of a cast and the casts closes them; the press still does what it does.
  const castShown = castOpen !== null
  useEffect(() => {
    if (!castShown) return
    const down = (event: PointerEvent) => {
      const target = event.target as Element | null
      if (popover.current?.contains(target) || target?.closest?.('[data-cast]')) return
      closeCast()
    }
    document.addEventListener('pointerdown', down, true)
    return () => document.removeEventListener('pointerdown', down, true)
  }, [castShown, closeCast])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as Element | null
      if (target?.closest?.('input, textarea, select')) return
      if (event.key === 'Escape') {
        closeCast()
        setExpandedEvent(null)
      } else if (event.key === ' ') {
        event.preventDefault()
        togglePlay()
      } else if (event.key === 'ArrowLeft') step(-STEP_MS)
      else if (event.key === 'ArrowRight') step(STEP_MS)
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [togglePlay, step, closeCast])

  const scope = useMemo<Scope>(
    () => ({
      chosen,
      span,
      lengthMs: span ? span.to - span.from : (summary?.durationMs ?? durationMs),
      mergePets: statistics?.settings.mergePets ?? true,
    }),
    [chosen, span, summary?.durationMs, durationMs, statistics?.settings.mergePets],
  )
  const scopeText = `${span ? `${clockText(span.from)} – ${clockText(span.to)}` : '整场'} · ${
    isEveryone(members, chosen) ? '全部角色' : `${chosen.size} 名角色`
  }`
  const overhealUnknown = useMemo(() => {
    const keys = new Set(
      (summary?.rows ?? []).filter((row) => row.metrics.overheal?.value == null).map((row) => row.actor.key),
    )
    return new Set(data.actors.filter((actor) => keys.has(actor.key)).map((actor) => actor.index))
  }, [summary, data])
  const unswitched = useMemo(() => listedEvents(data.events, chosen, span), [data, chosen, span])
  const counts = useMemo(() => countTypes(unswitched), [unswitched])
  const listed = useMemo(() => ofTypes(unswitched, types), [unswitched, types])
  const marked = useMemo(() => ofTypes(listedEvents(data.events, chosen, null), types), [data, chosen, types])
  const uptimeSpan = useMemo(() => span ?? { from: 0, to: durationMs }, [span, durationMs])
  const scroll = useCallback(
    (by: number) => setWindow((current) => scrollWindow(current, by, durationMs)),
    [durationMs],
  )
  /** A mark on the timeline expands its event in the list, and keeps it expanded when pressed again */
  const markEvent = useCallback(
    (event: ReplayEvent) => {
      setCastOpen(null)
      seek(event.t)
      setTab('events')
      setExpandedEvent(event)
    },
    [seek],
  )

  const toggleExpanded = () => {
    setExpanded(!expanded)
    setTab(expanded ? 'events' : tab === 'events' ? 'damage' : tab)
  }
  const measuring = expanded && panelDragged === null && fitted?.scope !== scope
  useLayoutEffect(() => {
    const box = measure.current,
      body = panel.current?.querySelector('.panel-body:not(.panel-measure)')
    if (!measuring || !box || !panel.current || !body) return
    // The border of the panel and the gutter of the scroll bar come on top of the content.
    const chrome = Math.max(0, panel.current.offsetWidth - body.clientWidth)
    setFitted({ scope, width: box.getBoundingClientRect().width + chrome })
  }, [measuring, scope])
  const side = panelWidth(middleSize.width, expanded, panelDragged, fitted?.width ?? null, mapHidden)
  const bottom = timelineOpen ? bottomHeight(mainSize.height, bottomDragged) : null
  // Until it is dragged, the timeline takes the height of its content, so a drag starts from the height it has on screen.
  const resizePanel = (down: React.PointerEvent) => {
    const element = panel.current
    if (!expanded || !element) return
    down.preventDefault()
    const start = down.clientX,
      from = element.getBoundingClientRect().width,
      middleWidth = middleSize.width
    drag((event) => setPanelDragged(panelWidth(middleWidth, true, from - (event.clientX - start))))
  }
  const resizeBottom = (down: React.PointerEvent) => {
    const element = bottomPanel.current
    if (!timelineOpen || !element) return
    down.preventDefault()
    const start = down.clientY,
      from = element.getBoundingClientRect().height,
      room = mainSize.height
    drag((event) => setBottomDragged(bottomHeight(room, from - (event.clientY - start))))
  }
  const bottomStyle: CSSProperties | undefined = !timelineOpen
    ? undefined
    : bottom === null
      ? { maxHeight: bottomLimit(mainSize.height) }
      : { height: bottom }

  const tabs = (shown: typeof TABS) => (
    <div className="panel-tabs">
      {mapHidden && (
        <>
          <button
            type="button"
            data-icon
            data-variant="ghost"
            aria-label="显示地图"
            interestfor={showMapTip}
            onClick={() => setMapHidden(false)}
          >
            <MapIcon />
          </button>
          <span id={showMapTip} popover="hint">
            显示地图
          </span>
        </>
      )}
      <div className="mojito-tabs" role="tablist">
        {shown.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <span className="grow" />
      <button type="button" data-variant="ghost" onClick={toggleExpanded}>
        {expanded ? <PanelRightClose /> : <PanelRightOpen />}
        {expanded ? '收起' : '详细数据'}
      </button>
    </div>
  )
  const rdps = summary?.contributionUnavailable === null
  let content = null
  const tableProps = { data, scope, names, scopeText }
  if (tab === 'events')
    content = (
      <EventList
        data={data}
        events={listed}
        counts={counts}
        types={types}
        onTypes={setTypes}
        time={time}
        playing={playing}
        expanded={expandedEvent}
        follow={moved}
        onSelect={selectEvent}
      />
    )
  else if (tab === 'damage')
    content = (
      <DamageTable
        {...tableProps}
        rdps={rdps}
        rdpsReason={summary?.contributionUnavailable ?? '这场战斗没有 rDPS 数据'}
        open={damageOpen}
        onOpen={setDamageOpen}
      />
    )
  else if (tab === 'taken')
    content = (
      <TakenTable {...tableProps} group={takenGroup} onGroup={setTakenGroup} open={takenOpen} onOpen={setTakenOpen} />
    )
  else if (tab === 'healing')
    content = (
      <HealingTable
        {...tableProps}
        group={healGroup}
        onGroup={setHealGroup}
        open={healOpen}
        onOpen={setHealOpen}
        overhealUnknown={overhealUnknown}
      />
    )
  else
    content = (
      <UptimeTable
        key={tab}
        data={data}
        kind={tab}
        chosen={chosen}
        span={uptimeSpan}
        names={names}
        open={tab === 'buff' ? buffOpen : debuffOpen}
        onOpen={tab === 'buff' ? setBuffOpen : setDebuffOpen}
      />
    )

  return (
    <div className="replay review">
      <ReplayHeader {...head}>
        {span && <SpanLabel span={span} onClear={() => setSpan(null)} />}
        <MemberFilter data={data} members={members} chosen={chosen} names={names} onChosen={setChosen} />
      </ReplayHeader>
      <div className="review-main" ref={main}>
        <div className="middle" ref={middle}>
          {!mapHidden && (
            <ReplayMap
              data={data}
              time={time}
              chosen={chosen}
              showNames={showNames}
              names={names}
              onShowNames={setShowNames}
              onHide={() => setMapHidden(true)}
            />
          )}
          <aside
            className={`side-panel${expanded ? ' expanded' : ''}${mapHidden ? ' alone' : ''}`}
            ref={panel}
            style={{ width: side ?? undefined, '--now': `${(time / (durationMs || 1)) * 100}%` } as CSSProperties}
          >
            {expanded && !mapHidden && <div className="panel-grip" onPointerDown={resizePanel} />}
            {tabs(expanded ? TABS : TABS.slice(0, 1))}
            <div className="panel-body">{content}</div>
            {measuring && (
              <PanelMeasure
                data={data}
                scope={scope}
                span={uptimeSpan}
                names={names}
                scopeText={scopeText}
                rdps={rdps}
                overhealUnknown={overhealUnknown}
                tabs={tabs(TABS)}
                measure={measure}
              />
            )}
          </aside>
        </div>
        <section className={`bottom${timelineOpen ? ' open' : ''}`} ref={bottomPanel} style={bottomStyle}>
          <div className="grip" onPointerDown={resizeBottom} />
          <PlaybackControls
            time={time}
            durationMs={durationMs}
            playing={playing}
            speed={speed}
            zoom={zoom}
            expanded={timelineOpen}
            onPlay={togglePlay}
            onSpeed={changeSpeed}
            onZoom={changeZoom}
            onExpand={() => setTimelineOpen(!timelineOpen)}
          />
          <OverviewStrip
            durationMs={durationMs}
            time={time}
            window={window}
            zoomed={zoom !== null && window.to - window.from < durationMs}
            events={marked}
            onPick={(at) => {
              seek(at)
              setWindow(windowAround(at, zoom, durationMs))
            }}
          />
          <Timeline
            data={data}
            time={time}
            window={window}
            chosen={chosen}
            events={marked}
            uses={uses}
            expanded={timelineOpen}
            names={names}
            selection={span}
            onSeek={seek}
            onSelectSpan={setSpan}
            onEvent={markEvent}
            openCast={castOpen?.index ?? null}
            onCast={openCast}
            onScroll={scroll}
            members={members}
            mergePets={scope.mergePets}
          />
        </section>
      </div>
      {castOpen && (
        <CastPopover
          data={data}
          cast={data.casts[castOpen.index]}
          left={castOpen.left}
          bottom={castOpen.bottom}
          popover={popover}
        />
      )}
    </div>
  )
})
