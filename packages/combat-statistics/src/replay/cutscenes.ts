import type { ReplayEvent } from '../view-model.js'

/**
 * The start and the end of each cutscene of a fight. A first change that says one stopped means it was already
 * playing when the fight started; one still playing ends with the fight.
 */
export function cutsceneEvents(changes: readonly { t: number; playing: boolean }[], durationMs: number): ReplayEvent[] {
  const events: ReplayEvent[] = []
  const add = (from: number, to: number) => {
    if (to > from)
      events.push(
        { kind: 'cutscene', t: from, edge: 'start', from, to },
        { kind: 'cutscene', t: to, edge: 'end', from, to },
      )
  }
  let playing: boolean | null = null
  let from = 0
  for (const change of [...changes].sort((a, b) => a.t - b.t)) {
    if (change.playing === playing) continue
    if (change.playing) from = change.t
    else add(from, change.t)
    playing = change.playing
  }
  if (playing) add(from, durationMs)
  return events
}
