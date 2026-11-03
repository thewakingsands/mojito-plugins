import type { Selection } from './view-model.js'

interface Visit {
  id: string
  fights: { id: string; number: number }[]
}

/**
 * The fight the overview shows. A pinned fight stays until the user returns to the current one. Following shows the
 * fight in progress, otherwise the newest fight of the newest visit that has one, so an ended fight stays on screen
 * until the next one starts.
 */
export function resolveSelection(
  visits: Visit[],
  activeFightId: string | null,
  following: boolean,
  pinned: Selection | null,
): Selection | null {
  if (!following && pinned) return pinned
  if (activeFightId !== null) {
    const visit = visits.find((item) => item.fights.some((fight) => fight.id === activeFightId)) ?? visits[0]
    return { visitId: visit?.id ?? '', fightId: activeFightId }
  }
  for (const visit of visits) {
    const newest = visit.fights.reduce<Visit['fights'][number] | null>(
      (found, fight) => (found === null || fight.number > found.number ? fight : found),
      null,
    )
    if (newest) return { visitId: visit.id, fightId: newest.id }
  }
  return null
}
