import type { ReplayEvent } from '../../view-model.js'
import { inSpan, type Span } from './aggregate.js'

export type BossEvent = Extract<ReplayEvent, { kind: 'bossIn' | 'bossOut' | 'bossDown' }>
export type CutsceneEvent = Extract<ReplayEvent, { kind: 'cutscene' }>
/** What happens to the fight itself, not to a member: the filter of the members leaves these alone */
export type FightEvent = BossEvent | CutsceneEvent

export const isBossEvent = (event: ReplayEvent): event is BossEvent =>
  event.kind === 'bossIn' || event.kind === 'bossOut' || event.kind === 'bossDown'
export const isFightEvent = (event: ReplayEvent): event is FightEvent => isBossEvent(event) || event.kind === 'cutscene'

/** The events of the chosen members and every event of the fight, within the span */
export function listedEvents(events: readonly ReplayEvent[], chosen: ReadonlySet<number>, span: Span | null) {
  return events.filter((event) => (isFightEvent(event) || chosen.has(event.actor)) && inSpan(event.t, span))
}

/** One event for each cutscene, whatever the span and the filter leave */
export const cutscenesOf = (events: readonly ReplayEvent[]) =>
  events.filter((event): event is CutsceneEvent => event.kind === 'cutscene' && event.edge === 'start')

/** The index of the last event at or before the time, -1 when there is none */
export function lastBefore(events: readonly ReplayEvent[], time: number): number {
  let found = -1
  for (let i = 0; i < events.length && events[i].t <= time; i++) found = i
  return found
}
