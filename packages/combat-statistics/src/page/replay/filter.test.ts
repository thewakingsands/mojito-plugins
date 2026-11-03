import { expect, it } from 'vitest'
import { chooseMember, chooseRole, everyone, type FilterMember, roleOn } from './filter.js'

const members: FilterMember[] = [
  { index: 0, role: 'tank' },
  { index: 1, role: 'tank' },
  { index: 2, role: 'healer' },
  { index: 3, role: 'dps' },
]
const all = everyone(members)

it('keeps only the member clicked when everyone is chosen', () => {
  expect(chooseMember(members, all, 2)).toEqual(new Set([2]))
})

it('adds and removes members otherwise, and goes back to everyone after the last one', () => {
  expect(chooseMember(members, new Set([2]), 3)).toEqual(new Set([2, 3]))
  expect(chooseMember(members, new Set([2, 3]), 3)).toEqual(new Set([2]))
  expect(chooseMember(members, new Set([2]), 2)).toEqual(all)
})

it('chooses the members of a role, and shows a role on only when exactly they are chosen', () => {
  const tanks = chooseRole(members, 'tank')
  expect(tanks).toEqual(new Set([0, 1]))
  expect(roleOn(members, tanks, 'tank')).toBe(true)
  expect(roleOn(members, new Set([0]), 'tank')).toBe(false)
  expect(roleOn(members, new Set([0, 1, 2]), 'tank')).toBe(false)
  expect(roleOn(members, all, 'healer')).toBe(false)
  expect(chooseRole(members.slice(0, 2), 'healer')).toEqual(new Set([0, 1]))
})
