import { expect, it } from 'vitest'
import { dpsCurves } from './curves.js'
import { enemy, member, pet, replayData } from './data.test-helper.js'

/** Members 0 and 1, pet 2 of member 0, enemy 3; a fight of ten seconds */
const data = replayData({
  fight: { visitId: 'v', fightId: 'f', durationMs: 10_000 },
  actors: [member(0, 19), member(1, 24), pet(2, 0), enemy(3, true)],
  entries: [
    { t: 0, actor: 0, other: 3, skill: 'action:9', field: 'damage', amount: 500 },
    { t: 999, actor: 0, other: 3, skill: 'action:9', field: 'damage', amount: 500 },
    { t: 5000, actor: 0, other: 3, skill: 'action:9', field: 'damage', amount: 2000 },
    // A revision takes some of it back
    { t: 5100, actor: 0, other: 3, skill: 'status:1', field: 'damage', amount: -500 },
    { t: 5000, actor: 0, other: 3, skill: 'action:9', field: 'taken', amount: 9999 },
    { t: 9999, actor: 2, other: 3, skill: 'action:100', field: 'damage', amount: 1000 },
    { t: 3000, actor: 1, other: 3, skill: 'action:9', field: 'damage', amount: 5000 },
  ],
})

it('averages the damage of each second over the two seconds on each side, as nothing outside the fight', () => {
  const curves = dpsCurves(data, new Set([0]), false)
  // Second 0 has 1000 and second 5 has 1500
  expect([...curves.get(0)!]).toEqual([200, 200, 200, 300, 300, 300, 300, 300, 0, 0])
})

it('puts the damage of a pet on its owner only when the pets are merged', () => {
  expect(
    dpsCurves(data, new Set([0]), true)
      .get(0)!
      .slice(7),
  ).toEqual(Float64Array.of(500, 200, 200))
  expect(
    dpsCurves(data, new Set([0]), false)
      .get(0)!
      .slice(7),
  ).toEqual(Float64Array.of(300, 0, 0))
})

it('has a curve for each chosen member only', () => {
  expect([...dpsCurves(data, new Set([1]), true).keys()]).toEqual([1])
  expect(dpsCurves(data, new Set([1]), true).get(1)![3]).toBe(1000)
  expect(dpsCurves(data, new Set(), true).size).toBe(0)
})
