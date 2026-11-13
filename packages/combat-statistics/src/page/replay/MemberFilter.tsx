import { useId } from 'react'
import type { Role } from '../../jobs.js'
import type { ReplayData } from '../../view-model.js'
import { JobIcon } from '../icons.js'
import {
  type Chosen,
  chooseMember,
  chooseRole,
  everyone,
  type FilterMember,
  isEveryone,
  onlyMember,
  roleOn,
} from './filter.js'
import { actorName } from './parts.js'

const ROLES: [Role, string][] = [
  ['tank', '坦克'],
  ['healer', '治疗'],
  ['dps', '输出'],
]

/**
 * The members the review shows: a button that names them and a popover to change them. The browser places the popover
 * and closes it on Esc or a press outside; a change applies at once and leaves it open.
 */
export function MemberFilter(props: {
  data: ReplayData
  members: readonly FilterMember[]
  chosen: Chosen
  names: Record<string, string>
  onChosen: (chosen: Chosen) => void
}) {
  const { data, members, chosen, names } = props
  const id = useId()
  const all = isEveryone(members, chosen)
  const job = (index: number) => {
    const actor = data.actors[index]
    return <JobIcon key={index} job={actor.job} abbreviation={names[`job:${actor.job}`]} />
  }
  return (
    <>
      <button type="button" className="member-filter-button" aria-haspopup="dialog" popoverTarget={id}>
        <span>角色：</span>
        {all ? (
          '全部'
        ) : (
          <span className="member-filter-icons">
            {members.filter((member) => chosen.has(member.index)).map((member) => job(member.index))}
          </span>
        )}
      </button>
      <div id={id} className="member-filter" popover="auto" role="dialog" aria-label="选择角色">
        <div className="member-filter-roles">
          <button type="button" aria-pressed={all} onClick={() => props.onChosen(everyone(members))}>
            全部
          </button>
          {ROLES.map(([role, label]) => (
            <button
              key={role}
              type="button"
              aria-pressed={roleOn(members, chosen, role)}
              onClick={() => props.onChosen(chooseRole(members, role))}
            >
              {label}
            </button>
          ))}
        </div>
        <ul className="member-filter-list">
          {members.map((member) => {
            const name = actorName(data.actors[member.index])
            return (
              <li key={member.index}>
                <label>
                  <input
                    type="checkbox"
                    checked={chosen.has(member.index)}
                    onChange={() => props.onChosen(chooseMember(members, chosen, member.index))}
                  />
                  {job(member.index)}
                  <span className="ellipsis">{name}</span>
                </label>
                <button
                  type="button"
                  data-variant="ghost"
                  aria-label={`只看${name}`}
                  onClick={() => props.onChosen(onlyMember(member.index))}
                >
                  只看
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </>
  )
}
