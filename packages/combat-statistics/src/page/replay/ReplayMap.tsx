import { memo, type RefObject, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReplayActor, ReplayData } from '../../view-model.js'
import { percent } from '../format.js'
import { JobIcon } from '../icons.js'
import { type Box, fitBounds, gridLines, project } from './bounds.js'
import { ringRotation } from './facing.js'
import { actorName } from './parts.js'
import { buildMapScene, deathTimes, enemyPane, type MapPane, paneLayout, sceneAt } from './scene.js'
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

/** One place on the map, scaled to fit the actors there */
function MapPaneView(props: {
  data: ReplayData
  pane: MapPane
  panes: readonly MapPane[]
  box: Box
  place: { left: number; top: number; width: number; height: number }
  time: number
  deaths: ReadonlyMap<number, readonly number[]>
  chosen: ReadonlySet<number>
  single: boolean
  showNames: boolean
  names: Record<string, string>
}) {
  const { data, pane, time, deaths, chosen } = props
  const { left, top, width, height } = props.place
  const bounds = fitBounds(props.box, width, height)
  const at = (x: number, z: number) => project(bounds, width, height, x, z)
  return (
    <div className="map-pane" style={{ left, top, width, height }}>
      <svg className="map" width={width} height={height}>
        <title>位置</title>
        {gridLines(bounds.minX, bounds.maxX).map((x) => (
          <line key={`x${x}`} className="grid" x1={at(x, 0)[0]} x2={at(x, 0)[0]} y1={0} y2={height} />
        ))}
        {gridLines(bounds.minZ, bounds.maxZ).map((z) => (
          <line key={`z${z}`} className="grid" x1={0} x2={width} y1={at(0, z)[1]} y2={at(0, z)[1]} />
        ))}
        {data.actors.map((actor) => {
          if (actor.kind !== 'enemy') return null
          const died = deaths.get(actor.index)?.[0] ?? null
          const pose = enemyShown(actor.track, died, time) && poseAt(actor.track, time)
          if (!pose || enemyPane(props.panes, data.actors, pose.x, pose.z, time) !== pane) return null
          const [x, y] = at(pose.x, pose.z)
          return <EnemyMarker key={actor.index} actor={actor} x={x} y={y} rotation={pose.rotation} hp={pose.hp} />
        })}
      </svg>
      {pane.members.map((index) => {
        const actor = data.actors[index]
        if (!memberShown(actor.track, time)) return null
        const pose = poseAt(actor.track, time)!
        const [x, y] = at(pose.x, pose.z)
        const down = isDown(actor.track, deaths.get(actor.index) ?? [], time)
        const name = actorName(actor)
        const hp = Number.isNaN(pose.hp) ? '' : ` · HP ${percent(pose.hp * 100)}`
        const classes = [
          'map-member',
          !chosen.has(actor.index) && 'unchosen',
          down && 'down',
          props.single && chosen.has(actor.index) && 'only',
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
}

/** The positions of the members and enemies at the time, each place zoomed to the actors there */
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
  const scene = useMemo(() => buildMapScene(data), [data])
  const deaths = useMemo(() => deathTimes(data.events), [data])
  if (!scene.segments.length)
    return (
      <div className="map-wrapper" ref={wrapper}>
        <p className="placeholder map-empty">这场战斗没有位置记录</p>
      </div>
    )
  const views = sceneAt(scene, time)
  const panes = views.map((view) => view.pane)
  const layout = paneLayout(views.length, width, height)
  const single = chosen.size === 1
  return (
    <div className={`map-wrapper${views.length > 1 ? ' split' : ''}`} ref={wrapper}>
      {views.map((view, i) => (
        <MapPaneView
          key={view.pane.key}
          data={data}
          pane={view.pane}
          panes={panes}
          box={view.box}
          place={layout[i]}
          time={time}
          deaths={deaths}
          chosen={chosen}
          single={single}
          showNames={props.showNames}
          names={props.names}
        />
      ))}
    </div>
  )
})
