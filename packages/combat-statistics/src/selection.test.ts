import { expect, it } from 'vitest'
import { resolveSelection } from './selection.js'

const visits = [
  { id: 'v3', fights: [] },
  {
    id: 'v2',
    fights: [
      { id: 'f1', number: 1 },
      { id: 'f2', number: 2 },
    ],
  },
  { id: 'v1', fights: [{ id: 'f0', number: 1 }] },
]

it('follows the fight in progress, then keeps the newest ended fight', () => {
  expect(resolveSelection(visits, 'f2', true, null)).toEqual({ visitId: 'v2', fightId: 'f2' })
  expect(resolveSelection(visits, null, true, null)).toEqual({ visitId: 'v2', fightId: 'f2' })
})
it('keeps a pinned fight when a new one starts', () => {
  const pinned = { visitId: 'v1', fightId: 'f0' }
  expect(resolveSelection(visits, 'f2', false, pinned)).toEqual(pinned)
})
it('selects nothing without any fight', () => {
  expect(resolveSelection([], null, true, null)).toBeNull()
  expect(resolveSelection([{ id: 'v3', fights: [] }], null, true, null)).toBeNull()
})
