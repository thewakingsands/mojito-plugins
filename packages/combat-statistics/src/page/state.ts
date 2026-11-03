import type { Selection, StatisticsState } from '../view-model.js'

/** Viewing an earlier fight while another one runs */
export const showBanner = (state: Pick<StatisticsState, 'following' | 'activeFightId' | 'selection'>) =>
  !state.following && state.activeFightId !== null && state.selection?.fightId !== state.activeFightId

/** Only one visit is expanded at a time; choosing the expanded one collapses it. */
export const toggleVisit = (expanded: string | null, id: string) => (expanded === id ? null : id)

export function toggle(keys: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(keys)
  if (!next.delete(key)) next.add(key)
  return next
}

/**
 * The expanded visit after a new statistics state: the selected one when the page opens, and the one a followed
 * selection moved to, such as the visit of a new current fight. Otherwise the user's choice stays.
 */
export function expandedAfter(
  expanded: string | null,
  previous: Selection | null | undefined,
  next: Pick<StatisticsState, 'following' | 'selection'>,
): string | null {
  if (previous === undefined) return next.selection?.visitId ?? null
  if (next.following && next.selection && next.selection.visitId !== previous?.visitId) return next.selection.visitId
  return expanded
}
