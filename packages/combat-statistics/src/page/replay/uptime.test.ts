import { expect, it } from 'vitest'
import { enemy, member, pet, replayData } from './data.test-helper.js'
import { covered, merge, uptimeGroups } from './uptime.js'

it('covers the part of each interval within the span', () => {
  const span = { from: 1000, to: 3000 }
  // Overlapping the start, inside, overlapping the end, outside
  expect(covered([{ from: 0, to: 1500 }], span)).toBe(500)
  expect(covered([{ from: 1800, to: 2000 }], span)).toBe(200)
  expect(covered([{ from: 2500, to: 4000 }], span)).toBe(500)
  expect(covered([{ from: 3000, to: 4000 }], span)).toBe(0)
  expect(
    merge([
      { from: 2000, to: 3000 },
      { from: 0, to: 1000 },
      { from: 500, to: 1500 },
    ]),
  ).toEqual([
    { from: 0, to: 1500 },
    { from: 2000, to: 3000 },
  ])
})

/** A healer 0, a tank 1, a damage dealer 2, pet 3 of 2, the main enemy 4 and an add 5 */
const data = replayData({
  actors: [
    member(0, 24, '白魔'),
    member(1, 19, '骑士'),
    member(2, 23, '诗人'),
    pet(3, 2),
    enemy(4, false),
    enemy(5, true),
  ],
  statusInfo: [
    { statusId: 100, name: '增益', category: 'buff', raidBuff: false },
    { statusId: 101, name: '另一个增益', category: 'buff', raidBuff: false },
    { statusId: 215, name: '伤害降低', category: 'debuff', raidBuff: false },
    { statusId: 300, name: '雪仇', category: 'debuff', raidBuff: false },
  ],
  statuses: [
    { actor: 0, statusId: 100, source: 2, from: 0, to: 5000, stacks: null },
    { actor: 0, statusId: 100, source: 2, from: 4000, to: 6000, stacks: null },
    { actor: 0, statusId: 101, source: 1, from: 0, to: 1000, stacks: null },
    { actor: 0, statusId: 101, source: 3, from: 1000, to: 2000, stacks: null },
    { actor: 1, statusId: 101, source: null, from: 9000, to: 10_000, stacks: null },
    { actor: 2, statusId: 100, source: 0, from: 0, to: 1000, stacks: null },
    { actor: 1, statusId: 215, source: 4, from: 0, to: 2000, stacks: null },
    { actor: 4, statusId: 300, source: 3, from: 0, to: 4000, stacks: null },
    { actor: 5, statusId: 300, source: 1, from: 0, to: 2000, stacks: null },
    { actor: 5, statusId: 300, source: null, from: 5000, to: 8000, stacks: null },
  ],
})
const span = { from: 0, to: 8000 }

it('lists the buffs of the chosen members by role, the most covered first, each source once', () => {
  const groups = uptimeGroups(data, 'buff', new Set([0, 1, 2]), span)
  // The tank's only buff is outside the span, so the tank has no group
  expect(groups.map((group) => group.actor)).toEqual([0, 2])
  expect(groups[0].lines).toEqual([
    { statusId: 100, sources: ['诗人'], uptime: 0.75, intervals: [{ from: 0, to: 6000 }], penalty: false },
    {
      statusId: 101,
      sources: ['骑士', '宠物3'],
      uptime: 0.25,
      intervals: [{ from: 0, to: 2000 }],
      penalty: false,
    },
  ])
  expect(uptimeGroups(data, 'buff', new Set([2]), span).map((group) => group.actor)).toEqual([2])
})

it('lists the debuffs of the chosen members and those they or their pets put on enemies, the main enemy first', () => {
  const groups = uptimeGroups(data, 'debuff', new Set([0, 1, 2]), span)
  expect(groups.map((group) => group.actor)).toEqual([1, 5, 4])
  expect(groups[0].lines[0]).toMatchObject({ statusId: 215, penalty: true, sources: ['敌人4'] })
  // A debuff of unknown source on an enemy is not one of the members'
  expect(groups[1].lines[0]).toMatchObject({ statusId: 300, uptime: 0.25, sources: ['骑士'] })
  expect(uptimeGroups(data, 'debuff', new Set([2]), span).map((group) => group.actor)).toEqual([4])
})
