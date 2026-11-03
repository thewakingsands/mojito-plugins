import { ENTRY_FIELDS, type ReplayData } from '../../view-model.js'
import { rowOf } from './aggregate.js'

const DAMAGE = ENTRY_FIELDS.indexOf('damage')
/** The seconds on each side of a second that its value averages */
const HALF_WINDOW = 2

/** Damage per second of each chosen member, one value per second of the fight, smoothed over five seconds */
export function dpsCurves(
  data: ReplayData,
  chosen: ReadonlySet<number>,
  mergePets: boolean,
): Map<number, Float64Array> {
  const seconds = Math.max(1, Math.ceil(data.fight.durationMs / 1000))
  const sums = new Map<number, Float64Array>()
  for (const actor of chosen) if (data.actors[actor]?.kind === 'member') sums.set(actor, new Float64Array(seconds))
  const { entries } = data
  for (let i = 0; i < entries.t.length; i++) {
    if (entries.field[i] !== DAMAGE) continue
    const sum = sums.get(rowOf(data.actors, entries.actor[i], mergePets))
    if (sum) sum[Math.min(seconds - 1, Math.floor(entries.t[i] / 1000))] += entries.amount[i]
  }
  const curves = new Map<number, Float64Array>()
  for (const [actor, sum] of sums) {
    const curve = new Float64Array(seconds)
    for (let second = 0; second < seconds; second++) {
      let total = 0
      for (let near = second - HALF_WINDOW; near <= second + HALF_WINDOW; near++)
        if (near >= 0 && near < seconds) total += sum[near]
      curve[second] = total / (HALF_WINDOW * 2 + 1)
    }
    curves.set(actor, curve)
  }
  return curves
}
