import { expect, it } from 'vitest'
import { catalog, context, field, monster, player } from './fixtures.test-helper.js'
import { HuntTracker } from './hunts.js'

it('distinguishes fresh observation from cached coordinates and absent objects', () => {
  const tracker = new HuntTracker(),
    c = catalog(),
    m = monster()
  expect(tracker.update(context(), c, [m], player(), 9000).entries[0]).toMatchObject({
    state: 'observed',
    distanceM: 5,
    heightDifferenceM: -2,
    lastObservedAt: 10000,
  })
  expect(tracker.update(context(13000), c, [m], player(), 9000).entries[0]).toMatchObject({
    state: 'last-seen',
    distanceM: null,
    hpPercent: null,
    lastObservedAt: 10000,
  })
  m.position = field({ x: 3, y: -2, z: -4 }, 13000)
  expect(tracker.update(context(13000), c, [m], null, 9000).entries[0].state).toBe('observed')
  expect(tracker.update(context(13000), c, [], null, 9000).entries[0]).toMatchObject({
    state: 'last-seen',
    lastObservedAt: 13000,
  })
  tracker.reset()
  expect(tracker.update(context(), c, [], null, null).entries).toEqual([])
})
it('requires fresh HP to confirm death and newer living evidence to resume', () => {
  const tracker = new HuntTracker(),
    m = monster(),
    c = catalog()
  m.hpCur = field(0, 5000)
  expect(tracker.update(context(), c, [m], null, null).entries[0].state).toBe('observed')
  m.hpCur = field(0)
  expect(tracker.update(context(), c, [m], null, null).entries[0].state).toBe('ended')
  m.position = field({ x: 4, y: 0, z: 0 }, 11000)
  m.hpCur = field(100)
  expect(tracker.update(context(11000), c, [m], null, null).entries[0].state).toBe('ended')
  m.hpCur = field(100, 11000)
  expect(tracker.update(context(11000), c, [m], null, null).entries[0].state).toBe('observed')
  m.hpCur = field(0, 10000)
  expect(tracker.update(context(11000), c, [m], null, null).entries[0]).toMatchObject({
    state: 'observed',
    hpPercent: null,
  })
})
it('keeps same-name actors separate and replaces reused identities', () => {
  const tracker = new HuntTracker(),
    c = catalog(),
    a = monster(),
    b = monster(8)
  expect(tracker.update(context(), c, [a, b], null, null).entries).toHaveLength(2)
  a.bNpcBase = field(999)
  expect(tracker.update(context(), c, [a, b], null, null).entries.map((e) => e.actorId)).toEqual([8])
  b.position = { state: 'unknown', reason: 'missing' }
  expect(tracker.update(context(), c, [b], null, null).entries[0].state).toBe('last-seen')
})
it('does not manufacture coordinates or current distance on incomplete observations', () => {
  const tracker = new HuntTracker(),
    c = catalog(),
    m = monster()
  m.position = { state: 'unavailable', reason: 'missing' }
  expect(tracker.update(context(), c, [m], player(), null).entries[0]).toMatchObject({
    state: 'position-unknown',
    position: null,
    lastObservedAt: null,
    distanceM: null,
  })
  expect(tracker.update(context(), c, null, player(), null)).toMatchObject({ status: 'unavailable' })
})

it('retains current monster observation but hides distance when the local player disappears', () => {
  const p = player()
  p.actorId = { state: 'unknown', reason: 'Local player not observed' }
  expect(new HuntTracker().update(context(), catalog(), [monster()], p, null).entries[0]).toMatchObject({
    state: 'observed',
    distanceM: null,
    heightDifferenceM: null,
  })
})
