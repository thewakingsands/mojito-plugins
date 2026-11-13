import type { Role } from '../../jobs.js'
import type { ReplayActor, ReplayData } from '../../view-model.js'
import { JobIcon, LimitBreakIcon } from '../icons.js'

export const ROLE_CLASS: Record<Role, string> = { tank: 'role-tank', healer: 'role-healer', dps: 'role-dps' }

export const actorName = (actor: ReplayActor | undefined) =>
  actor?.kind === 'limitBreak' ? '极限技' : (actor?.name ?? `角色 ${actor?.index ?? '?'}`)
export const actionName = (data: ReplayData, actionId: number | null, name?: string | null) => {
  if (actionId === null) return '未知技能'
  return name ?? data.actions.find((action) => action.actionId === actionId)?.name ?? `技能 #${actionId}`
}
export const statusName = (data: ReplayData, statusId: number, name?: string | null) =>
  name ?? data.statusInfo.find((info) => info.statusId === statusId)?.name ?? `状态 #${statusId}`
/** Who a hit or status came from: the actor, the name the log had, or neither */
export const sourceName = (data: ReplayData, source: number | null, name: string | null) =>
  source !== null ? actorName(data.actors[source]) : (name ?? '未知来源')

/** The enemy mark of the map, also used in the panel next to an enemy's name */
export function Diamond({ main, size = 14, hollow = false }: { main: boolean; size?: number; hollow?: boolean }) {
  const half = size / 2
  // A hollow one keeps its stroke inside the box
  const inset = hollow ? 1 : 0
  const classes = ['diamond', main && 'main', hollow && 'hollow'].filter(Boolean).join(' ')
  return (
    <svg className={classes} width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <title>{main ? '主要敌人' : '敌人'}</title>
      <path d={`M${half} ${inset}L${size - inset} ${half}L${half} ${size - inset}L${inset} ${half}Z`} />
    </svg>
  )
}

/** A job icon, or the diamond of an enemy */
export function ActorIcon({ actor, names }: { actor: ReplayActor; names: Record<string, string> }) {
  if (actor.kind === 'enemy') return <Diamond main={actor.main} size={16} />
  if (actor.kind === 'limitBreak') return <LimitBreakIcon />
  return <JobIcon job={actor.job} abbreviation={names[`job:${actor.job}`]} />
}
