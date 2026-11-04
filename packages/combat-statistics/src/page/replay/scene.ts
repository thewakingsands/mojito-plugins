import type { ReplayActor, ReplayData, ReplayEvent } from '../../view-model.js'
import type { Box } from './bounds.js'
import { enemyShown, FAR_METERS, memberShown, poseAt } from './tracks.js'

const STEP_MS = 250
/** A grouping that lasts shorter than this is members passing through on the way to a teleport */
const SETTLE_MS = 2000
/** A view holds still as long as the members stay within a range this wide */
const MAX_SPAN_METERS = 40
/** A view that starts wider than the maximum may grow by this factor, so that it does not change at every step */
const WIDE_GROWTH = 1.5
/** A view eases to the next one over this long on each side of the change */
const EASE_MS = 1000

export interface MapPane {
  /** Member indexes sorted and joined, as the React key */
  key: string
  members: readonly number[]
}
interface PaneTrack {
  pane: MapPane
  /** The range at each step of the segment; null only when the pane has no range in the whole segment */
  boxes: readonly (Box | null)[]
  /** The section of each step: the range is not eased or interpolated between sections */
  sections: readonly number[]
}
interface MapSegment {
  from: number
  panes: readonly PaneTrack[]
}
export interface MapScene {
  /** In order of time; empty without member positions */
  segments: readonly MapSegment[]
}

/** The times each actor died */
export function deathTimes(events: readonly ReplayEvent[]): Map<number, number[]> {
  const result = new Map<number, number[]>()
  for (const event of events)
    if (event.kind === 'death' || event.kind === 'bossDown')
      result.set(event.actor, [...(result.get(event.actor) ?? []), event.t])
  return result
}

type Point = { x: number; z: number }
/** Member indexes in groups, both sorted, so that equal groupings have equal keys */
type Grouping = readonly (readonly number[])[]
interface Run {
  /** Steps, the end exclusive */
  from: number
  to: number
  groups: Grouping
}

const keyOf = (groups: Grouping) => groups.map((group) => group.join(',')).join('|')
const sortGroups = (groups: number[][]): Grouping =>
  groups.map((group) => group.sort((a, b) => a - b)).sort((a, b) => a[0] - b[0])
const near = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z) <= FAR_METERS

/** Single linkage: members within the distance of each other, directly or through others, are one group */
function groupMembers(positions: ReadonlyMap<number, Point>): Grouping {
  const members = [...positions.keys()]
  const parent = new Map(members.map((member) => [member, member]))
  const find = (member: number): number => {
    let root = member
    while (parent.get(root) !== root) root = parent.get(root)!
    parent.set(member, root)
    return root
  }
  for (let i = 0; i < members.length; i++)
    for (let j = i + 1; j < members.length; j++)
      if (near(positions.get(members[i])!, positions.get(members[j])!)) parent.set(find(members[i]), find(members[j]))
  const groups = new Map<number, number[]>()
  for (const member of members) {
    const root = find(member)
    groups.set(root, [...(groups.get(root) ?? []), member])
  }
  return sortGroups([...groups.values()])
}

/** Members share a group of the result only when they share one in every grouping that has anyone in it */
function commonRefinement(groupings: readonly Grouping[]): Grouping {
  const present = groupings.filter((groups) => groups.length > 0)
  const signatures = new Map<number, string[]>()
  present.forEach((groups, g) => {
    groups.forEach((group, i) => {
      for (const member of group) {
        const signature = signatures.get(member) ?? present.map(() => '')
        signature[g] = String(i)
        signatures.set(member, signature)
      }
    })
  })
  const groups = new Map<string, number[]>()
  for (const [member, signature] of signatures) {
    const key = signature.join(',')
    groups.set(key, [...(groups.get(key) ?? []), member])
  }
  return sortGroups([...groups.values()])
}

/** Whether the grouping has every member of the other, and only puts together members the other puts together */
function refines(groups: Grouping, other: Grouping): boolean {
  const owner = new Map(other.flatMap((group, i) => group.map((member): [number, number] => [member, i])))
  const own = new Set(groups.flat())
  if ([...owner.keys()].some((member) => !own.has(member))) return false
  return groups.every((group) => group.every((member) => owner.get(member) === owner.get(group[0])))
}

/** Folds the brief groupings of a teleport, where members do not move at once, so that the panes change only once */
function settleRuns(runs: readonly Run[]): Run[] {
  const stable = (run: Run) => (run.to - run.from) * STEP_MS >= SETTLE_MS
  const result: Run[] = []
  const add = (run: Run) => {
    const last = result[result.length - 1]
    if (last && keyOf(last.groups) === keyOf(run.groups)) result[result.length - 1] = { ...last, to: run.to }
    else result.push(run)
  }
  for (let i = 0; i < runs.length; ) {
    if (stable(runs[i])) {
      add(runs[i++])
      continue
    }
    let end = i
    while (end < runs.length && !stable(runs[end])) end++
    const common = commonRefinement(runs.slice(i, end).map((run) => run.groups))
    const before: Run | undefined = runs[i - 1]
    const after: Run | undefined = runs[end]
    // Only a finer grouping is taken, so the members of a pane stay close to each other throughout.
    const groups =
      after && refines(after.groups, common)
        ? after.groups
        : before && refines(before.groups, common)
          ? before.groups
          : common
    add({ from: runs[i].from, to: runs[end - 1].to, groups })
    i = end
  }
  return result
}

/** The pane of the enemy: that of the nearest member, unless even that member is far away */
export function enemyPane(
  panes: readonly MapPane[],
  actors: readonly ReplayActor[],
  x: number,
  z: number,
  time: number,
): MapPane | null {
  let nearest: MapPane | null = null
  let distance = FAR_METERS
  for (const pane of panes)
    for (const member of pane.members) {
      const track = actors[member].track
      if (!memberShown(track, time)) continue
      const pose = poseAt(track, time)!
      const away = Math.hypot(pose.x - x, pose.z - z)
      if (away <= distance) {
        distance = away
        nearest = pane
      }
    }
  return nearest
}

const include = (box: Box | null, x: number, z: number): Box =>
  box
    ? {
        minX: Math.min(box.minX, x),
        maxX: Math.max(box.maxX, x),
        minZ: Math.min(box.minZ, z),
        maxZ: Math.max(box.maxZ, z),
      }
    : { minX: x, maxX: x, minZ: z, maxZ: z }

const spanOf = (box: Box) => Math.max(box.maxX - box.minX, box.maxZ - box.minZ)
const merge = (a: Box, b: Box): Box => ({
  minX: Math.min(a.minX, b.minX),
  maxX: Math.max(a.maxX, b.maxX),
  minZ: Math.min(a.minZ, b.minZ),
  maxZ: Math.max(a.maxZ, b.maxZ),
})
const lerp = (a: number, b: number, f: number) => a + (b - a) * f
const lerpBox = (a: Box, b: Box, f: number): Box => ({
  minX: lerp(a.minX, b.minX, f),
  maxX: lerp(a.maxX, b.maxX, f),
  minZ: lerp(a.minZ, b.minZ, f),
  maxZ: lerp(a.maxZ, b.maxZ, f),
})

/** A step without a range takes that of the nearest step that has one */
function fillGaps(raw: readonly (Box | null)[]): (Box | null)[] {
  const steps = raw.flatMap((box, i) => (box ? [i] : []))
  return raw.map((box, i) => {
    if (box || !steps.length) return box
    return raw[steps.reduce((best, step) => (Math.abs(step - i) < Math.abs(best - i) ? step : best))]
  })
}

/**
 * Views that stay fixed for as long as they can: each takes in the members up to the step they no longer fit. Enemies
 * join a view only where they fit, so that only a member leaving it changes the view.
 */
function holdViews(
  members: readonly Box[],
  enemies: readonly (Box | null)[],
): { from: number; to: number; box: Box }[] {
  const views: { from: number; to: number; box: Box }[] = []
  for (let from = 0; from < members.length; ) {
    let box = members[from]
    const limit = Math.max(MAX_SPAN_METERS, spanOf(box) * WIDE_GROWTH)
    let to = from + 1
    for (; to < members.length; to++) {
      const next = merge(box, members[to])
      if (spanOf(next) > limit) break
      box = next
    }
    for (const enemy of enemies.slice(from, to)) {
      const next = enemy && merge(box, enemy)
      if (next && spanOf(next) <= limit) box = next
    }
    views.push({ from, to, box })
    from = to
  }
  return views
}

/**
 * The range at each step of a section. Around a change it widens to take in both views and then narrows, which keeps
 * every step's view inside the range.
 */
function sectionRanges(members: readonly (Box | null)[], enemies: readonly (Box | null)[]): (Box | null)[] {
  const filled = fillGaps(members)
  const boxes = filled.filter((box) => box !== null)
  if (!boxes.length) return filled
  const views = holdViews(boxes, enemies)
  const reach = EASE_MS / STEP_MS
  return views.flatMap((view, v) => {
    const before = views[v - 1]
    const after = views[v + 1]
    return boxes.slice(view.from, view.to).map((_, i) => {
      let box = view.box
      if (before && i < reach) box = merge(box, lerpBox(merge(before.box, view.box), view.box, i / reach))
      const left = view.to - view.from - i
      if (after && left <= reach)
        box = merge(box, lerpBox(view.box, merge(view.box, after.box), (reach - left + 1) / reach))
      return box
    })
  })
}

/** The displayed ranges, computed apart for each section, so that a teleport switches them outright */
function paneRanges(
  members: readonly (Box | null)[],
  enemies: readonly (Box | null)[],
  sections: readonly number[],
): (Box | null)[] {
  const result: (Box | null)[] = []
  for (let from = 0; from < members.length; ) {
    let to = from
    while (to < members.length && sections[to] === sections[from]) to++
    result.push(...sectionRanges(members.slice(from, to), enemies.slice(from, to)))
    from = to
  }
  return result
}

/** Everything the map shows over the fight, computed once: a time gives the same map however it was reached */
export function buildMapScene(data: Pick<ReplayData, 'actors' | 'events' | 'fight'>): MapScene {
  const members = data.actors.filter((actor) => actor.kind === 'member')
  if (members.every((actor) => actor.track.t.length === 0)) return { segments: [] }
  const enemies = data.actors.filter((actor) => actor.kind === 'enemy')
  const deaths = deathTimes(data.events)
  const count = Math.ceil(data.fight.durationMs / STEP_MS) + 1

  const positions = Array.from({ length: count }, (_, step) => {
    const at = new Map<number, Point>()
    for (const actor of members)
      if (memberShown(actor.track, step * STEP_MS)) at.set(actor.index, poseAt(actor.track, step * STEP_MS)!)
    return at
  })

  const runs: Run[] = []
  positions.forEach((at, step) => {
    const groups = groupMembers(at)
    const last = runs[runs.length - 1]
    if (last && keyOf(last.groups) === keyOf(groups)) last.to = step + 1
    else runs.push({ from: step, to: step + 1, groups })
  })

  const segments = settleRuns(runs).map((run): MapSegment => {
    const center = (group: readonly number[]) => {
      const at = positions.slice(run.from, run.to).find((step) => group.some((member) => step.has(member)))
      const points = group.flatMap((member) => at?.get(member) ?? [])
      const average = (side: 'x' | 'z') => points.reduce((sum, point) => sum + point[side], 0) / points.length
      return { row: Math.floor(average('z') / FAR_METERS), x: average('x') }
    }
    const panes = run.groups
      .map((group) => ({ key: group.join('-'), members: group, center: center(group) }))
      .sort((a, b) => a.center.row - b.center.row || a.center.x - b.center.x)
      .map(({ key, members }): MapPane => ({ key, members }))

    const memberBoxes = panes.map((): (Box | null)[] => [])
    const enemyBoxes = panes.map((): (Box | null)[] => [])
    const sections = panes.map((): number[] => [])
    for (let step = run.from; step < run.to; step++) {
      panes.forEach((pane, p) => {
        let box: Box | null = null
        let moved = false
        for (const member of pane.members) {
          const point = positions[step].get(member)
          if (!point) continue
          box = include(box, point.x, point.z)
          const previous = step > run.from ? positions[step - 1].get(member) : undefined
          if (previous && !near(previous, point)) moved = true
        }
        memberBoxes[p].push(box)
        enemyBoxes[p].push(null)
        const section = sections[p][sections[p].length - 1] ?? 0
        sections[p].push(moved ? section + 1 : section)
      })
      const time = step * STEP_MS
      for (const actor of enemies) {
        const pose = enemyShown(actor.track, deaths.get(actor.index)?.[0] ?? null, time) && poseAt(actor.track, time)
        if (!pose) continue
        const pane = enemyPane(panes, data.actors, pose.x, pose.z, time)
        if (!pane) continue
        const list = enemyBoxes[panes.indexOf(pane)]
        list[list.length - 1] = include(list[list.length - 1], pose.x, pose.z)
      }
    }
    return {
      from: run.from * STEP_MS,
      panes: panes.map((pane, p) => ({
        pane,
        boxes: paneRanges(memberBoxes[p], enemyBoxes[p], sections[p]),
        sections: sections[p],
      })),
    }
  })
  return { segments }
}

/** The panes shown at the time and the range of each */
export function sceneAt(scene: MapScene, time: number): { pane: MapPane; box: Box }[] {
  let segment: MapSegment | undefined = scene.segments[0]
  for (const candidate of scene.segments) if (candidate.from <= time) segment = candidate
  if (!segment) return []
  const position = Math.max(0, time - segment.from) / STEP_MS
  const result: { pane: MapPane; box: Box }[] = []
  for (const { pane, boxes, sections } of segment.panes) {
    const i = Math.min(Math.floor(position), boxes.length - 1)
    const box = boxes[i]
    if (!box) continue
    const next = boxes[i + 1]
    if (!next || sections[i + 1] !== sections[i]) {
      result.push({ pane, box })
      continue
    }
    result.push({ pane, box: lerpBox(box, next, position - i) })
  }
  return result
}

/** Equal panes filling the map: the rows and columns that make their short side longest, then leave the fewest empty */
export function paneLayout(
  count: number,
  width: number,
  height: number,
): { left: number; top: number; width: number; height: number }[] {
  let best = { rows: 1, columns: count, short: -1, empty: 0 }
  for (let rows = 1; rows <= count; rows++) {
    const columns = Math.ceil(count / rows)
    const short = Math.min(width / columns, height / rows)
    const empty = rows * columns - count
    if (short > best.short || (short === best.short && empty < best.empty)) best = { rows, columns, short, empty }
  }
  const paneWidth = width / best.columns,
    paneHeight = height / best.rows
  return Array.from({ length: count }, (_, i) => ({
    left: (i % best.columns) * paneWidth,
    top: Math.floor(i / best.columns) * paneHeight,
    width: paneWidth,
    height: paneHeight,
  }))
}
