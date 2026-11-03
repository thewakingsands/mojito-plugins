import type { ReactNode, RefObject } from 'react'
import type { ReplayData } from '../../view-model.js'
import type { Scope, Span } from './aggregate.js'
import { DamageTable, HealingTable, TakenTable, UptimeTable } from './DetailTables.js'

const none = () => {}

/**
 * The tabs and every table of the side panel with every row open, out of sight, so the expanded panel can take the
 * width of the widest of them and keep it whichever tab is shown.
 */
export function PanelMeasure(props: {
  data: ReplayData
  scope: Scope
  span: Span
  names: Record<string, string>
  scopeText: string
  rdps: boolean
  overhealUnknown: ReadonlySet<number>
  tabs: ReactNode
  measure: RefObject<HTMLDivElement | null>
}) {
  const { data, scope, names, scopeText } = props
  const open = new Set(data.actors.map((actor) => actor.index))
  const table = { data, scope, names, scopeText, open, onOpen: none }
  const uptime = { data, chosen: scope.chosen, span: props.span, names, open, onOpen: none }
  return (
    <div className="panel-body panel-measure" ref={props.measure} aria-hidden>
      {props.tabs}
      <div>
        <DamageTable {...table} rdps={props.rdps} rdpsReason={null} />
      </div>
      <div>
        <TakenTable {...table} group="actor" onGroup={none} />
      </div>
      <div>
        <TakenTable {...table} group="skill" onGroup={none} />
      </div>
      {(['actor', 'skill', 'target'] as const).map((group) => (
        <div key={group}>
          <HealingTable {...table} group={group} onGroup={none} overhealUnknown={props.overhealUnknown} />
        </div>
      ))}
      <div>
        <UptimeTable {...uptime} kind="buff" />
      </div>
      <div>
        <UptimeTable {...uptime} kind="debuff" />
      </div>
    </div>
  )
}
