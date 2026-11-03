import { penaltyStatuses } from '../../replay/catalog.js'
import type { ReplayActor, ReplayData } from '../../view-model.js'
import type { Span } from './aggregate.js'

export interface UptimeLine {
  statusId: number
  /** The names of who gave it, each once */
  sources: string[]
  /** Share of the span it was on, 0–1 */
  uptime: number
  /** When it was on over the whole fight, merged */
  intervals: Span[]
  penalty: boolean
}
export interface UptimeGroup {
  actor: number
  lines: UptimeLine[]
}

/** Overlapping intervals merged, in time order */
export function merge(intervals: readonly Span[]): Span[] {
  const merged: Span[] = []
  for (const interval of [...intervals].sort((a, b) => a.from - b.from)) {
    const last = merged.at(-1)
    if (last && interval.from <= last.to) last.to = Math.max(last.to, interval.to)
    else merged.push({ ...interval })
  }
  return merged
}
/** How long the merged intervals cover of the span */
export function covered(intervals: readonly Span[], span: Span): number {
  let total = 0
  for (const interval of intervals)
    total += Math.max(0, Math.min(interval.to, span.to) - Math.max(interval.from, span.from))
  return total
}

const ROLE_ORDER = { tank: 0, healer: 1, dps: 2 } as const
/** Members by role, then the main enemy, then the other enemies; the data order within each */
function rank(actor: ReplayActor) {
  if (actor.kind === 'member') return actor.role === null ? 3 : ROLE_ORDER[actor.role]
  return actor.main ? 4 : 5
}

/**
 * The buffs or debuffs by actor. Buffs are those on the chosen members; debuffs also those the chosen members or
 * their pets put on enemies.
 */
export function uptimeGroups(data: ReplayData, kind: 'buff' | 'debuff', chosen: ReadonlySet<number>, span: Span) {
  const category = new Map(data.statusInfo.map((info) => [info.statusId, info.category]))
  const fromChosen = (source: number | null) => {
    if (source === null) return false
    const actor = data.actors[source]
    return chosen.has(actor.kind === 'pet' && actor.owner !== null ? actor.owner : source)
  }
  const byActor = new Map<number, Map<number, { intervals: Span[]; sources: Set<number | null> }>>()
  for (const status of data.statuses) {
    if (category.get(status.statusId) !== kind) continue
    const on = data.actors[status.actor]
    if (on.kind === 'member' ? !chosen.has(on.index) : kind === 'buff' || !fromChosen(status.source)) continue
    let statuses = byActor.get(on.index)
    if (!statuses) {
      statuses = new Map()
      byActor.set(on.index, statuses)
    }
    let line = statuses.get(status.statusId)
    if (!line) {
      line = { intervals: [], sources: new Set() }
      statuses.set(status.statusId, line)
    }
    line.intervals.push({ from: status.from, to: status.to })
    line.sources.add(status.source)
  }
  const length = span.to - span.from
  const groups: UptimeGroup[] = []
  for (const [actor, statuses] of byActor) {
    const lines: UptimeLine[] = []
    for (const [statusId, { intervals, sources }] of statuses) {
      const merged = merge(intervals)
      const uptime = length > 0 ? covered(merged, span) / length : 0
      if (uptime <= 0) continue
      const names = [...sources].map((source) => (source === null ? null : data.actors[source].name))
      lines.push({
        statusId,
        sources: [...new Set(names.filter((name): name is string => name !== null))],
        uptime,
        intervals: merged,
        penalty: penaltyStatuses.has(statusId),
      })
    }
    if (lines.length) groups.push({ actor, lines: lines.sort((a, b) => b.uptime - a.uptime) })
  }
  return groups.sort((a, b) => rank(data.actors[a.actor]) - rank(data.actors[b.actor]) || a.actor - b.actor)
}
