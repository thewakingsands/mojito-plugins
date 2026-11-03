import { memo, type RefObject, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReplayActor, ReplayData } from '../../view-model.js'
import { percent } from '../format.js'
import { JobIcon } from '../icons.js'
import { gridLines, mapBounds, project } from './bounds.js'
import { ringRotation } from './facing.js'
import { actorName } from './parts.js'
import { enemyShown, isDown, memberShown, poseAt } from './tracks.js'

const MEMBER_SIZE = 30
const MAIN_SIZE = 40
const ENEMY_SIZE = 22

/** The size of an element, following it as it changes */
export function useSize(ref: RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight })
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return size
}

const point = (degrees: number, radius: number) => {
  const angle = (degrees * Math.PI) / 180
  return `${(radius * Math.sin(angle)).toFixed(2)} ${(-radius * Math.cos(angle)).toFixed(2)}`
}
/** Two 270° arcs open at the back and an arrow in front, pointing up before it is turned */
function ringPath(size: number) {
  const outer = size / 2 + 8,
    inner = outer * 0.86
  const arc = (radius: number) => `M${point(-135, radius)}A${radius} ${radius} 0 1 1 ${point(135, radius)}`
  return `${arc(outer)}${arc(inner)}M0 ${-(outer + 6)}L-5 ${-(inner - 1)}L5 ${-(inner - 1)}Z`
}

export function EnemyMarker(props: { actor: ReplayActor; x: number; y: number; rotation: number; hp: number }) {
  const size = props.actor.main ? MAIN_SIZE : ENEMY_SIZE
  const half = size / 2
  const label = `${actorName(props.actor)}${Number.isNaN(props.hp) ? '' : ` ${Math.round(props.hp * 100)}%`}`
  return (
    <g className={`enemy${props.actor.main ? ' main' : ''}`} transform={`translate(${props.x} ${props.y})`}>
      <title>{label}</title>
      <path className="ring" d={ringPath(size)} transform={`rotate(${ringRotation(props.rotation)})`} />
      <path className="diamond-mark" d={`M0 ${-half}L${half} 0L0 ${half}L${-half} 0Z`} />
      <text className="map-label" y={half + 22}>
        {label}
      </text>
    </g>
  )
}

/** The positions of the members and enemies at the time, projected on a blank map */
export const ReplayMap = memo(function ReplayMap(props: {
  data: ReplayData
  time: number
  chosen: ReadonlySet<number>
  showNames: boolean
  names: Record<string, string>
}) {
  const { data, time, chosen } = props
  // Measured here rather than by the parent: a parent's ref is still unset when this child's layout effect runs on mount
  const wrapper = useRef<HTMLDivElement>(null)
  const { width, height } = useSize(wrapper)
  const shown = useMemo(() => data.actors.filter((actor) => actor.kind !== 'pet'), [data])
  const bounds = useMemo(
    () =>
      mapBounds(
        shown.map((actor) => actor.track),
        width,
        height,
      ),
    [shown, width, height],
  )
  const deaths = useMemo(() => {
    const result = new Map<number, number[]>()
    for (const event of data.events)
      if (event.kind === 'death' || event.kind === 'bossDown')
        result.set(event.actor, [...(result.get(event.actor) ?? []), event.t])
    return result
  }, [data])
  if (!bounds)
    return (
      <div className="map-wrapper" ref={wrapper}>
        <p className="placeholder map-empty">这场战斗没有位置记录</p>
      </div>
    )
  const at = (x: number, z: number) => project(bounds, width, height, x, z)
  const single = chosen.size === 1
  return (
    <div className="map-wrapper" ref={wrapper}>
      <svg className="map" width={width} height={height}>
        <title>位置</title>
        {gridLines(bounds.minX, bounds.maxX).map((x) => (
          <line key={`x${x}`} className="grid" x1={at(x, 0)[0]} x2={at(x, 0)[0]} y1={0} y2={height} />
        ))}
        {gridLines(bounds.minZ, bounds.maxZ).map((z) => (
          <line key={`z${z}`} className="grid" x1={0} x2={width} y1={at(0, z)[1]} y2={at(0, z)[1]} />
        ))}
        {shown.map((actor) => {
          if (actor.kind !== 'enemy') return null
          const died = deaths.get(actor.index)?.[0] ?? null
          const pose = enemyShown(actor.track, died, time) && poseAt(actor.track, time)
          if (!pose) return null
          const [x, y] = at(pose.x, pose.z)
          return <EnemyMarker key={actor.index} actor={actor} x={x} y={y} rotation={pose.rotation} hp={pose.hp} />
        })}
      </svg>
      {shown.map((actor) => {
        if (actor.kind !== 'member' || !memberShown(actor.track, time)) return null
        const pose = poseAt(actor.track, time)!
        const [x, y] = at(pose.x, pose.z)
        const down = isDown(actor.track, deaths.get(actor.index) ?? [], time)
        const name = actorName(actor)
        const hp = Number.isNaN(pose.hp) ? '' : ` · HP ${percent(pose.hp * 100)}`
        const classes = [
          'map-member',
          !chosen.has(actor.index) && 'unchosen',
          down && 'down',
          single && chosen.has(actor.index) && 'only',
        ]
        return (
          <div
            key={actor.index}
            className={classes.filter(Boolean).join(' ')}
            style={{ left: x, top: y, width: MEMBER_SIZE, height: MEMBER_SIZE }}
            title={`${name} · ${props.names[`job:${actor.job}`] ?? '未知职业'}${hp}`}
          >
            <JobIcon job={actor.job} abbreviation={props.names[`job:${actor.job}`]} />
            {props.showNames && <span className="map-name">{name}</span>}
          </div>
        )
      })}
    </div>
  )
})
