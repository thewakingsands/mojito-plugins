import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useState } from 'react'
import type { ReplayData } from '../../view-model.js'
import type { Span } from './aggregate.js'
import { dpsCurves } from './curves.js'
import type { FilterMember } from './filter.js'
import { actorName } from './parts.js'
import {
  analyzePotency,
  GAP_MS,
  MIN_WINDOW_SAMPLES,
  type PotencyAnalysis,
  type PotencyPoint,
  type PotencyRegion,
} from './potency.js'
import { clockText } from './timeline.js'

export const DPS_HEIGHT = 96
export const POTENCY_HEIGHT = 120
/** The categorical colors in style.css */
const CURVE_COLORS = 8
/** Keeps the lines off the top and bottom edges of a lane */
const INSET = 4
/** Past this x the hover tip opens to the left of the pointer */
const TIP_WIDTH = 180

/** What the card of a region shows, and the region block it opens above */
export interface RegionHover {
  region: PotencyRegion
  baseline: number
  /** The sample nearest the pointer */
  point: PotencyPoint | null
  anchor: HTMLElement
}

/** The color of a member follows its place in the filter bar, so choosing others does not repaint it */
export const curveColor = (members: readonly FilterMember[], actor: number) =>
  `var(--curve-${
    (Math.max(
      0,
      members.findIndex((member) => member.index === actor),
    ) %
      CURVE_COLORS) +
    1
  })`
export const signedPercent = (value: number) => `${value > 0 ? '+' : ''}${Math.round(value * 100)}%`
const nearest = (points: readonly PotencyPoint[], t: number) =>
  points.reduce<PotencyPoint | null>(
    (best, point) => (!best || Math.abs(point.t - t) < Math.abs(best.t - t) ? point : best),
    null,
  )

/** The curves of the whole fight; the lanes only draw the part in their window */
export function useCurves(
  data: ReplayData,
  chosen: ReadonlySet<number>,
  members: readonly FilterMember[],
  mergePets: boolean,
) {
  const dps = useMemo(() => dpsCurves(data, chosen, mergePets), [data, chosen, mergePets])
  const dpsMax = useMemo(() => {
    let max = 0
    for (const curve of dps.values()) for (const value of curve) max = Math.max(max, value)
    return max * 1.1 || 1
  }, [dps])
  const analyses = useMemo(() => {
    const result = new Map<number, PotencyAnalysis>()
    for (const member of members) {
      if (!chosen.has(member.index)) continue
      const analysis = analyzePotency(data, member.index)
      if (analysis) result.set(member.index, analysis)
    }
    return result
  }, [data, chosen, members])
  const [picked, setPicked] = useState<number | null>(null)
  const options = [...analyses.keys()]
  const actor = picked !== null && analyses.has(picked) ? picked : (options[0] ?? null)
  // A member chosen again later starts from the default, not from the earlier pick
  useEffect(() => {
    if (picked !== null && !analyses.has(picked)) setPicked(null)
  }, [picked, analyses])
  return { dps, dpsMax, analyses, options, actor, pick: setPicked }
}
export type Curves = ReturnType<typeof useCurves>

interface LaneBase {
  data: ReplayData
  window: Span
  width: number
  chosen: ReadonlySet<number>
  members: readonly FilterMember[]
  curves: Curves
  onPress: (down: ReactPointerEvent<HTMLElement>) => void
  /** The cutscene shades every lane starts with */
  shades: React.ReactNode
}

/** Lines from points, broken where the points say so */
function path(points: { x: number; y: number; break: boolean }[]): string {
  return points
    .map((point, index) => `${index === 0 || point.break ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join('')
}
function Tip(props: { x: number; width: number; height: number; children: React.ReactNode }) {
  const right = props.x > props.width - TIP_WIDTH
  return (
    <>
      <i className="curve-cursor" style={{ left: props.x, height: props.height }} />
      <span className="curve-tip" style={right ? { right: props.width - props.x + 8 } : { left: props.x + 8 }}>
        {props.children}
      </span>
    </>
  )
}
const timeAt = (down: { clientX: number; currentTarget: HTMLElement }, window: Span) => {
  const rect = down.currentTarget.getBoundingClientRect()
  return window.from + ((down.clientX - rect.left) / (rect.width || 1)) * (window.to - window.from)
}

export function DpsLabel(props: { data: ReplayData; members: readonly FilterMember[]; chosen: ReadonlySet<number> }) {
  return (
    <span className="label curve-label" style={{ height: DPS_HEIGHT }}>
      <span>每秒伤害</span>
      {props.members
        .filter((member) => props.chosen.has(member.index))
        .map((member) => (
          <span key={member.index} className="curve-legend">
            <i className="curve-swatch" style={{ background: curveColor(props.members, member.index) }} />
            <span className="ellipsis">{actorName(props.data.actors[member.index])}</span>
          </span>
        ))}
    </span>
  )
}

export function DpsLane(props: LaneBase) {
  const { window, width, curves } = props
  const [hover, setHover] = useState<number | null>(null)
  const length = window.to - window.from || 1
  const x = (t: number) => ((t - window.from) / length) * width
  const y = (value: number) => DPS_HEIGHT - INSET - (value / curves.dpsMax) * (DPS_HEIGHT - INSET * 2)
  const first = Math.max(0, Math.floor(window.from / 1000) - 1)
  const lines = [...curves.dps].map(([actor, curve]) => {
    const last = Math.min(curve.length - 1, Math.ceil(window.to / 1000) + 1)
    const points = []
    // A second's value sits in its middle
    for (let second = first; second <= last; second++)
      points.push({ x: x(second * 1000 + 500), y: y(curve[second]), break: false })
    return { actor, d: path(points) }
  })
  const second = hover === null ? null : Math.max(0, Math.floor(hover / 1000))
  return (
    <div
      className="lane curve"
      style={{ height: DPS_HEIGHT }}
      onPointerDown={props.onPress}
      onPointerMove={(move) => setHover(timeAt(move, window))}
      onPointerLeave={() => setHover(null)}
    >
      {props.shades}
      {props.chosen.size === 0 ? (
        <span className="curve-empty">未选择角色</span>
      ) : (
        <svg width={width} height={DPS_HEIGHT} aria-label="每秒伤害曲线">
          <title>每秒伤害曲线</title>
          {lines.map((line) => (
            <path
              key={line.actor}
              d={line.d}
              className="curve-line"
              style={{ stroke: curveColor(props.members, line.actor) }}
            />
          ))}
        </svg>
      )}
      {hover !== null && second !== null && curves.dps.size > 0 && (
        <Tip x={x(hover)} width={width} height={DPS_HEIGHT}>
          <b className="number">{clockText(hover)}</b>
          {[...curves.dps].map(([actor, curve]) => (
            <span key={actor} className="curve-tip-row">
              <i className="curve-swatch" style={{ background: curveColor(props.members, actor) }} />
              <span className="ellipsis">{actorName(props.data.actors[actor])}</span>
              <span className="number">{Math.round(curve[Math.min(curve.length - 1, second)] ?? 0)}</span>
            </span>
          ))}
        </Tip>
      )}
    </div>
  )
}

export function PotencyLabel(props: { data: ReplayData; curves: Curves }) {
  const { curves } = props
  return (
    <span className="label curve-label" style={{ height: POTENCY_HEIGHT }}>
      <span>每威力伤害</span>
      {curves.actor !== null && (
        <select
          aria-label="每威力伤害的角色"
          value={curves.actor}
          onChange={(change) => curves.pick(Number(change.currentTarget.value))}
        >
          {curves.options.map((actor) => (
            <option key={actor} value={actor}>
              {actorName(props.data.actors[actor])}
            </option>
          ))}
        </select>
      )}
    </span>
  )
}

/** How the damage per potency of a sample was brought back to that of a hit neither critical nor direct */
function conversionOf(point: PotencyPoint): string {
  if (point.critical && point.direct) return ' · 暴击直击换算'
  if (point.critical) return ' · 暴击换算'
  if (point.direct) return ' · 直击换算'
  return ''
}

/** The window value of a sample; one alone in its window has no value of its own to show */
export function windowNote(point: PotencyPoint): string {
  if (point.n === 1) return '窗口内只有这一个样本，不参与区域判定'
  const value = `窗口值 ${point.w.toFixed(1)}`
  return point.n < MIN_WINDOW_SAMPLES ? `${value}（窗口内 ${point.n} 个样本，不参与区域判定）` : value
}

export function PotencyLane(props: LaneBase & { onRegion: (hover: RegionHover | null) => void }) {
  const { window, width, curves, onRegion } = props
  const [hover, setHover] = useState<number | null>(null)
  const [inRegion, setInRegion] = useState(false)
  const analysis = curves.actor === null ? null : (curves.analyses.get(curves.actor) ?? null)
  const range = useMemo(() => {
    if (!analysis) return null
    let low = analysis.baseline,
      high = analysis.baseline
    for (const point of analysis.points) {
      low = Math.min(low, point.r)
      high = Math.max(high, point.r)
    }
    const pad = (high - low || high || 1) * 0.05
    return { low: low - pad, high: high + pad }
  }, [analysis])
  // The card goes with the member and the data it came from
  useEffect(() => {
    if (!analysis) onRegion(null)
  }, [analysis, onRegion])

  const length = window.to - window.from || 1
  const x = (t: number) => ((t - window.from) / length) * width
  let body: React.ReactNode
  if (props.chosen.size === 0) body = <span className="curve-empty">未选择角色</span>
  else if (!analysis || !range)
    body = <span className="curve-empty">没有每威力数据：记录时宿主没有提供，或选中的角色没有可推断威力的命中</span>
  else {
    const y = (value: number) =>
      POTENCY_HEIGHT - INSET - ((value - range.low) / (range.high - range.low)) * (POTENCY_HEIGHT - INSET * 2)
    const visible = (t: number) => t >= window.from - GAP_MS && t <= window.to + GAP_MS
    const shown = analysis.points.filter((point) => visible(point.t))
    const line = path(
      shown.map((point, index) => ({
        x: x(point.t),
        y: y(point.w),
        break: index > 0 && point.t - shown[index - 1].t > GAP_MS,
      })),
    )
    const regionHover = (region: PotencyRegion, event: ReactPointerEvent<HTMLElement>) => {
      setInRegion(true)
      onRegion({
        region,
        baseline: analysis.baseline,
        point: nearest(
          analysis.points,
          timeAt({ clientX: event.clientX, currentTarget: event.currentTarget.parentElement! }, window),
        ),
        anchor: event.currentTarget,
      })
    }
    body = (
      <>
        {analysis.regions
          .filter((region) => region.to >= window.from && region.from <= window.to)
          .map((region) => (
            <span
              key={region.from}
              className={`potency-region ${region.deviation > 0 ? 'up' : 'down'}`}
              data-region
              style={{ left: x(region.from), width: Math.max(2, x(region.to) - x(region.from)) }}
              onPointerEnter={(enter) => regionHover(region, enter)}
              onPointerMove={(move) => regionHover(region, move)}
              onPointerLeave={() => {
                setInRegion(false)
                onRegion(null)
              }}
            >
              <span className="potency-arrow" title={region.deviation > 0 ? '高于基准' : '低于基准'}>
                {region.deviation > 0 ? '↑' : '↓'}
              </span>
            </span>
          ))}
        <svg width={width} height={POTENCY_HEIGHT} aria-label="每威力伤害曲线">
          <title>每威力伤害曲线</title>
          <line className="potency-baseline" x1={0} x2={width} y1={y(analysis.baseline)} y2={y(analysis.baseline)} />
          {analysis.points
            .filter((point) => point.t >= window.from && point.t <= window.to)
            .map((point) => (
              <circle key={point.t} className="potency-sample" cx={x(point.t)} cy={y(point.r)} r={2} />
            ))}
          <path d={line} className="curve-line" style={{ stroke: curveColor(props.members, curves.actor!) }} />
        </svg>
        <span className="potency-baseline-label number" style={{ top: y(analysis.baseline) - 16 }}>
          基准 {analysis.baseline.toFixed(1)}
        </span>
      </>
    )
  }
  const point = analysis && hover !== null ? nearest(analysis.points, hover) : null
  return (
    <div
      className="lane curve"
      style={{ height: POTENCY_HEIGHT }}
      onPointerDown={props.onPress}
      onPointerMove={(move) => setHover(timeAt(move, window))}
      onPointerLeave={() => setHover(null)}
    >
      {props.shades}
      {body}
      {analysis && point && hover !== null && !inRegion && (
        <Tip x={x(hover)} width={width} height={POTENCY_HEIGHT}>
          <b className="number">{clockText(hover)}</b>
          <span className="number">
            最近样本 {clockText(point.t)} · 每威力 {point.r.toFixed(1)}
            {conversionOf(point)}
          </span>
          <span className="number">{windowNote(point)}</span>
          <span className="number">
            基准 {analysis.baseline.toFixed(1)}
            {` · 偏离 ${signedPercent(point.w / analysis.baseline - 1)}`}
          </span>
          {analysis.critical !== null && (
            <span className="number">暴击倍率 {analysis.critical.toFixed(2)}（本场实测）</span>
          )}
          {analysis.droppedCritical > 0 && (
            <span className="number">暴击样本不足，未计入 {analysis.droppedCritical} 个暴击命中</span>
          )}
        </Tip>
      )}
    </div>
  )
}
