import { ENTRY_FIELDS, type Entries, type ReplayActor, type ReplayEvent } from '../view-model.js'

const DAMAGE = ENTRY_FIELDS.indexOf('damage')
/** A boss takes at least this share of the damage the main enemy took */
const BOSS_SHARE = 0.1
/** A boss whose last position comes this long before the end has left */
const LEFT_MS = 1000
/** A boss also becomes untargetable when it falls: a change this long before that, or later, is no leaving */
const DOWN_MS = 1000

export interface TargetableChange {
  t: number
  /** Actor index */
  actor: number
  targetable: boolean
}

/** The damage each enemy took from the members and their pets, by actor index */
function damageTaken(entries: Entries): Map<number, number> {
  const taken = new Map<number, number>()
  for (let i = 0; i < entries.t.length; i++)
    if (entries.field[i] === DAMAGE && entries.other[i] >= 0)
      taken.set(entries.other[i], (taken.get(entries.other[i]) ?? 0) + entries.amount[i])
  return taken
}

/**
 * The changes of one boss in time order without the repeats, and whether it could be targeted before them. A change
 * at time 0 tells the state the fight started in; a later first change means the other state held until then.
 */
function targetableHistory(changes: readonly TargetableChange[]) {
  const history: TargetableChange[] = []
  for (const change of [...changes].sort((a, b) => a.t - b.t))
    if (history.at(-1)?.targetable !== change.targetable) history.push(change)
  if (history.length === 0) return { initial: true, history }
  const [first] = history
  return first.t === 0
    ? { initial: first.targetable, history: history.slice(1) }
    : { initial: !first.targetable, history }
}

/**
 * When each boss came, left and fell. The bosses are the main enemy and the enemies that took at least a tenth of
 * its damage; without a main enemy there are none.
 * @param deaths The review time of the actorDied of each enemy, by actor index
 * @param targetables The targetable changes of the enemies; a boss without any is told by its positions alone
 */
export function bossEvents(
  actors: readonly ReplayActor[],
  entries: Entries,
  deaths: ReadonlyMap<number, number>,
  durationMs: number,
  targetables: readonly TargetableChange[] = [],
): ReplayEvent[] {
  const main = actors.find((actor) => actor.main)
  if (!main) return []
  const taken = damageTaken(entries)
  const threshold = (taken.get(main.index) ?? 0) * BOSS_SHARE
  const events: ReplayEvent[] = []
  for (const actor of actors) {
    if (actor.kind !== 'enemy' || (actor !== main && (taken.get(actor.index) ?? 0) < threshold)) continue
    const { t, hp } = actor.track
    const last = t.length - 1
    const { initial, history } = targetableHistory(targetables.filter((change) => change.actor === actor.index))
    if (last >= 0 && initial) events.push({ kind: 'bossIn', t: t[0], actor: actor.index })
    const down = deaths.get(actor.index) ?? (last >= 0 && hp[last] === 0 ? t[last] : undefined)
    if (down !== undefined) events.push({ kind: 'bossDown', t: down, actor: actor.index })
    for (const change of history) {
      if (change.targetable) events.push({ kind: 'bossIn', t: change.t, actor: actor.index })
      else if (down === undefined || change.t < down - DOWN_MS)
        events.push({ kind: 'bossOut', t: change.t, actor: actor.index, reason: 'untargetable' })
    }
    if (down === undefined && last >= 0 && t[last] < durationMs - LEFT_MS) {
      const targetable = history.findLast((change) => change.t <= t[last])?.targetable ?? initial
      if (targetable) events.push({ kind: 'bossOut', t: t[last], actor: actor.index, reason: 'left' })
    }
  }
  return events.sort((a, b) => a.t - b.t)
}
