import { expect, it } from 'vitest'
import { expandedAfter, showBanner, toggle, toggleVisit } from './state.js'

it('shows the banner only while an earlier fight is viewed during another one', () => {
  const pinned = { visitId: 'v1', fightId: 'f1' }
  expect(showBanner({ following: false, activeFightId: 'f2', selection: pinned })).toBe(true)
  expect(showBanner({ following: false, activeFightId: null, selection: pinned })).toBe(false)
  expect(showBanner({ following: true, activeFightId: 'f2', selection: { visitId: 'v1', fightId: 'f2' } })).toBe(false)
})
it('expands one visit at a time', () => {
  expect(toggleVisit(null, 'v1')).toBe('v1')
  expect(toggleVisit('v1', 'v2')).toBe('v2')
  expect(toggleVisit('v2', 'v2')).toBeNull()
  expect([...toggle(toggle(new Set(['a']), 'b'), 'a')]).toEqual(['b'])
})
it('expands the selected visit on opening and follows a new current visit, keeping the user choice otherwise', () => {
  const v1 = { visitId: 'v1', fightId: 'f1' },
    v2 = { visitId: 'v2', fightId: 'f2' }
  expect(expandedAfter(null, undefined, { following: true, selection: v1 })).toBe('v1')
  expect(expandedAfter(null, undefined, { following: true, selection: null })).toBeNull()
  expect(expandedAfter('v1', v1, { following: true, selection: v2 })).toBe('v2')
  expect(expandedAfter('v3', v1, { following: false, selection: v2 })).toBe('v3')
  expect(expandedAfter(null, v1, { following: true, selection: { visitId: 'v1', fightId: 'f3' } })).toBeNull()
})
