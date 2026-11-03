import type { Role } from '../../jobs.js'

/** The members of the filter bar: their indexes in the review data and roles */
export interface FilterMember {
  index: number
  role: Role | null
}
export type Chosen = ReadonlySet<number>

export const everyone = (members: readonly FilterMember[]): Chosen => new Set(members.map((member) => member.index))
export const isEveryone = (members: readonly FilterMember[], chosen: Chosen) => chosen.size === members.length

/** Only the members of the role; everyone when it has none */
export function chooseRole(members: readonly FilterMember[], role: Role): Chosen {
  const chosen = new Set(members.filter((member) => member.role === role).map((member) => member.index))
  return chosen.size ? chosen : everyone(members)
}

/**
 * From everyone, a click keeps only the member; otherwise it adds or removes the member, and removing the last one
 * goes back to everyone.
 */
export function chooseMember(members: readonly FilterMember[], chosen: Chosen, index: number): Chosen {
  if (isEveryone(members, chosen)) return new Set([index])
  const next = new Set(chosen)
  if (!next.delete(index)) next.add(index)
  return next.size ? next : everyone(members)
}

/** A role button is on when exactly the members of the role are chosen */
export function roleOn(members: readonly FilterMember[], chosen: Chosen, role: Role): boolean {
  const ofRole = members.filter((member) => member.role === role)
  return ofRole.length > 0 && ofRole.length === chosen.size && ofRole.every((member) => chosen.has(member.index))
}
