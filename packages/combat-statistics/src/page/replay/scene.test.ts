import { expect, it } from 'vitest'
import type { ReplayActor } from '../../view-model.js'
import { enemy, member, track } from './data.test-helper.js'
import { buildMapScene, enemyPane, type MapScene, paneLayout, sceneAt } from './scene.js'

const DURATION = 60_000
const scene = (actors: ReplayActor[], durationMs = DURATION) =>
  buildMapScene({ actors, events: [], fight: { visitId: 'v', fightId: 'f', durationMs } })

/** A member's samples every 250 ms from the position its function gives */
const walker = (index: number, position: (t: number) => [number, number], durationMs = DURATION) =>
  member(
    index,
    19,
    undefined,
    track(
      Array.from({ length: durationMs / 250 + 1 }, (_, i): [number, number, number] => {
        const t = i * 250
        return [t, ...position(t)]
      }),
    ),
  )

const memberLists = (map: MapScene, time: number) => sceneAt(map, time).map(({ pane }) => pane.members)
/** The times the panes change, with each time's panes */
function changes(map: MapScene, durationMs = DURATION) {
  const result: number[] = []
  let last = ''
  for (let t = 0; t <= durationMs; t += 250) {
    const key = sceneAt(map, t)
      .map(({ pane }) => pane.key)
      .join('|')
    if (t > 0 && key !== last) result.push(t)
    last = key
  }
  return result
}
const contains = (box: { minX: number; maxX: number; minZ: number; maxZ: number }, x: number, z: number) =>
  box.minX <= x + 1e-3 && x - 1e-3 <= box.maxX && box.minZ <= z + 1e-3 && z - 1e-3 <= box.maxZ

it('follows the members with one pane while they are together, always containing them', () => {
  const positions = [(t: number): [number, number] => [t / 1000, 0], (t: number): [number, number] => [t / 1000, 10]]
  const map = scene(positions.map((position, i) => walker(i, position)))
  expect(changes(map)).toEqual([])
  for (let t = 0; t <= DURATION; t += 125) {
    const [view] = sceneAt(map, t)
    expect(view.pane.members).toEqual([0, 1])
    for (const position of positions) expect(contains(view.box, ...position(t))).toBe(true)
  }
  expect(sceneAt(map, 55_000)[0].box.minX).toBeGreaterThan(sceneAt(map, 10_000)[0].box.minX)
})

it('holds the view still while the members move within it', () => {
  const wander = (t: number): [number, number] => [100 + 15 * Math.sin(t / 3000), 100 + 15 * Math.cos(t / 5000)]
  const map = scene([walker(0, wander), walker(1, (t) => [100 - wander(t)[0] + 100, 100])])
  const first = sceneAt(map, 0)[0].box
  for (let t = 0; t <= DURATION; t += 250) expect(sceneAt(map, t)[0].box).toEqual(first)
})

it('changes the view only when a member no longer fits, and eases to the next one', () => {
  // Stands still for 30 s, walks 60 meters in 12 s, and stands still again
  const x = (t: number) => Math.max(0, Math.min(60, (t - 30_000) / 200))
  const map = scene([walker(0, (t) => [x(t), 0])])
  expect(sceneAt(map, 10_000)[0].box).toEqual(sceneAt(map, 30_000)[0].box)
  const later = sceneAt(map, 50_000)[0].box
  expect(sceneAt(map, DURATION)[0].box).toEqual(later)
  expect(later).not.toEqual(sceneAt(map, 10_000)[0].box)
  let last = sceneAt(map, 0)[0].box
  for (let t = 250; t <= DURATION; t += 250) {
    const { box } = sceneAt(map, t)[0]
    expect(contains(box, x(t), 0)).toBe(true)
    expect(Math.abs(box.minX - last.minX)).toBeLessThan(15)
    expect(Math.abs(box.maxX - last.maxX)).toBeLessThan(15)
    last = box
  }
})

it('does not change the view for an enemy that does not fit, only for a member', () => {
  const actors = [
    walker(0, () => [0, 0]),
    enemy(
      1,
      true,
      track([
        [0, 0, 0],
        [30_000, 10, 0],
        [30_250, 55, 0],
        [DURATION, 55, 0],
      ]),
    ),
  ]
  const map = scene(actors)
  const first = sceneAt(map, 0)[0].box
  expect(first.maxX).toBe(10)
  for (let t = 0; t <= DURATION; t += 250) expect(sceneAt(map, t)[0].box).toEqual(first)
})

it('splits members 61 meters apart, not those 60 meters apart', () => {
  const pair = (distance: number) => scene([walker(0, () => [0, 0]), walker(1, () => [distance, 0])])
  expect(memberLists(pair(60), 1000)).toEqual([[0, 1]])
  expect(memberLists(pair(61), 1000)).toEqual([[0], [1]])
})

it('joins members through the ones between them', () => {
  const map = scene([walker(0, () => [0, 0]), walker(1, () => [50, 0]), walker(2, () => [100, 0])])
  expect(memberLists(map, 1000)).toEqual([[0, 1, 2]])
})

it('switches the range outright when the whole party teleports, without shrinking or growing around it', () => {
  const at = (t: number) => (t < 30_000 ? 0 : 200)
  const map = scene([walker(0, (t) => [at(t), 0]), walker(1, (t) => [at(t) + 20, 0])])
  expect(changes(map)).toEqual([])
  for (let t = 0; t <= DURATION; t += 250) {
    const [{ box }] = sceneAt(map, t)
    expect(box.maxX - box.minX).toBeLessThanOrEqual(40)
    expect(contains(box, at(t), 0)).toBe(true)
  }
})

it('keeps one layout change when members teleport back to one place within four seconds', () => {
  // The members land a second apart, so the groupings between the landings last under two seconds.
  const homes = [0, 200, 400, 600]
  const landing = [0, 30_000, 31_000, 32_000]
  const position =
    (i: number) =>
    (t: number): [number, number] => [t >= landing[i] ? 0 : homes[i], 0]
  const map = scene(homes.map((_, i) => walker(i, position(i))))
  expect(changes(map)).toEqual([32_000])
  expect(memberLists(map, 29_000)).toEqual([[0], [1], [2], [3]])
  expect(memberLists(map, 40_000)).toEqual([[0, 1, 2, 3]])
  for (let t = 0; t <= DURATION; t += 250)
    for (const { box } of sceneAt(map, t)) expect(box.maxX - box.minX).toBeLessThanOrEqual(40)
})

it('keeps members apart when their distance crosses the limit for under two seconds each time', () => {
  const swinging = (t: number): [number, number] => [t >= 20_000 && t < 40_000 && Math.floor(t / 1000) % 2 ? 50 : 70, 0]
  const map = scene([walker(0, () => [0, 0]), walker(1, swinging)])
  expect(changes(map)).toEqual([])
  expect(memberLists(map, 30_000)).toEqual([[0], [1]])
})

it('leaves out an enemy far from every member', () => {
  const far = track([
    [0, 500, 500],
    [DURATION, 500, 500],
  ])
  const close = track([
    [0, 40, 0],
    [DURATION, 40, 0],
  ])
  const actors = [walker(0, () => [0, 0]), enemy(1, true, far)]
  const [view] = sceneAt(scene(actors), 1000)
  expect(view.box).toEqual({ minX: 0, maxX: 0, minZ: 0, maxZ: 0 })
  expect(enemyPane([view.pane], actors, 500, 500, 1000)).toBeNull()
  expect(enemyPane([view.pane], actors, 40, 0, 1000)).toBe(view.pane)
  expect(sceneAt(scene([actors[0], enemy(1, true, close)]), 1000)[0].box.maxX).toBe(40)
})

it('puts an enemy in the pane of the nearest member', () => {
  const actors = [walker(0, () => [0, 0]), walker(1, () => [100, 0])]
  const panes = sceneAt(scene(actors), 1000).map(({ pane }) => pane)
  expect(enemyPane(panes, actors, 20, 0, 1000)).toBe(panes[0])
  expect(enemyPane(panes, actors, 70, 0, 1000)).toBe(panes[1])
})

it('does not depend on what was asked before', () => {
  const map = scene([walker(0, (t) => [t < 30_000 ? 0 : 100, 0]), walker(1, () => [0, 0])])
  const first = sceneAt(map, 40_100)
  sceneAt(map, 5000)
  sceneAt(map, 59_000)
  expect(sceneAt(map, 40_100)).toEqual(first)
})

it('arranges the panes by where they are at the start of the segment', () => {
  const map = scene([walker(0, () => [200, 0]), walker(1, () => [0, 0]), walker(2, () => [0, -200])])
  expect(memberLists(map, 1000)).toEqual([[2], [1], [0]])
})

it('moves the range gradually', () => {
  const map = scene([walker(0, (t) => [t < 30_000 ? 0 : Math.min(50, (t - 30_000) / 100), 0])])
  let last = sceneAt(map, 0)[0].box.maxX
  for (let t = 250; t <= DURATION; t += 250) {
    const { maxX } = sceneAt(map, t)[0].box
    expect(Math.abs(maxX - last)).toBeLessThan(5)
    last = maxX
  }
})

it('lays the panes out to make them as large as possible', () => {
  const grid = (count: number) => {
    const panes = paneLayout(count, 800, 600)
    return [new Set(panes.map((pane) => pane.left)).size, new Set(panes.map((pane) => pane.top)).size]
  }
  expect(grid(1)).toEqual([1, 1])
  expect(grid(2)).toEqual([2, 1])
  expect(grid(3)).toEqual([2, 2])
  expect(grid(8)).toEqual([4, 2])
  expect(paneLayout(3, 800, 600)[2]).toEqual({ left: 0, top: 300, width: 400, height: 300 })
})

it('has no segments without member positions, even with enemy positions', () => {
  expect(scene([member(0, 19), enemy(1, true, track([[0, 0, 0]]))]).segments).toEqual([])
})

it('shows nothing where no member has appeared in a stretch of its own', () => {
  const map = scene([member(0, 19, undefined, track([[5000, 0, 0]]))], 10_000)
  expect(sceneAt(map, 1000)).toEqual([])
  expect(memberLists(map, 6000)).toEqual([[0]])
})
