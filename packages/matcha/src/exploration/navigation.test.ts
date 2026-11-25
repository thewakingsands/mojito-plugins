import { expect, it } from 'vitest'
import { guidance, headingDegrees, mapCoordinate } from './coordinates.js'
import { catalog, context, field, player } from './fixtures.test-helper.js'
import { navigationState } from './navigation.js'

const target = { itemId: 88, spotIndex: 0, since: 5000 }
it('uses world X/Z distance and Y height while preserving zero and negative values', () => {
  const state = navigationState(context(), catalog(), target, player(), 9000)
  expect(state.target?.z).toBe(-0.02)
  expect(state.guidance).toEqual({
    distanceM: 10,
    heightDifferenceM: -2,
    bearingDegrees: 0,
    relativeDegrees: -180,
    near: false,
  })
  expect(state.player).toEqual({ x: 21.5, y: 21.5, headingDegrees: 180 })
  expect(mapCoordinate(364.934, 0, 100)).toBeCloseTo(28.8058076)
  expect(mapCoordinate(0, 100, 200)).toBeCloseTo(13.251953125)
})
it('uses north-clockwise directions and omits unstable arrows near the target', () => {
  expect([0, Math.PI / 2, Math.PI, -Math.PI / 2].map(headingDegrees)).toEqual([180, 90, 0, 270])
  expect(guidance({ x: 0, y: 0, z: 0 }, { x: 10, y: null, z: 0 }, 0)).toMatchObject({
    bearingDegrees: 90,
    relativeDegrees: 90,
    heightDifferenceM: null,
  })
  expect(guidance({ x: 0, y: 0, z: 0 }, { x: 0, y: 5, z: 0 }, 0)).toMatchObject({
    near: true,
    bearingDegrees: null,
    relativeDegrees: null,
    heightDifferenceM: 5,
  })
})
it('retains the static target through stale position, unknown heading and region changes', () => {
  const p = player()
  p.rotation = field(0, 7000)
  expect(navigationState(context(), catalog(), target, p, null)).toMatchObject({
    status: 'ready',
    player: { headingDegrees: null },
    guidance: { bearingDegrees: 0, relativeDegrees: null },
  })
  expect(navigationState(context(13000), catalog(), target, p, null)).toMatchObject({
    status: 'unavailable',
    target: { itemId: 88 },
    player: null,
    guidance: null,
  })
  expect(navigationState({ ...context(), territoryId: 999 }, catalog(), target, p, null)).toMatchObject({
    status: 'other-territory',
    target: { itemId: 88 },
    player: null,
  })
  expect(navigationState(context(), catalog(), null, p, null).status).toBe('no-target')
  expect(navigationState(context(), catalog(), { ...target, itemId: 99 }, p, null).status).toBe('unavailable')
})
it('rejects old-zone and incomparable observations, and accepts one newer than the clock', () => {
  const p = player()
  expect(navigationState(context(), catalog(), target, p, 10001).player).toBeNull()
  expect(navigationState(context(9999), catalog(), target, p, null).player).not.toBeNull()
  expect(
    navigationState(
      { ...context(), clock: { ...context().clock, base: 'host-monotonic-unix' } },
      catalog(),
      target,
      p,
      null,
    ).player,
  ).toBeNull()
})
it('keeps horizontal navigation when height is unavailable and rejects ambiguous maps', () => {
  const c = catalog(),
    t = c.targets[88][0]
  t.world.y = null
  t.z = null
  t.zStatus = 'unavailable'
  expect(navigationState(context(), c, target, player(), null).guidance).toMatchObject({
    distanceM: 10,
    heightDifferenceM: null,
  })
  c.territoryMaps[148] = null
  expect(navigationState(context(), c, target, player(), null).status).toBe('unavailable')
})

it('removes own navigation immediately when actor identity disappears despite cached fresh coordinates', () => {
  const p = player()
  p.actorId = { state: 'unknown', reason: 'Local player not observed' }
  expect(navigationState(context(), catalog(), target, p, null)).toMatchObject({
    status: 'unavailable',
    player: null,
    guidance: null,
  })
})

it('reports when the current treasure map was first seen, whatever its status', () => {
  expect(navigationState(context(), catalog(), target, player(), null).targetSince).toBe(5000)
  expect(navigationState(context(), null, target, null, null).targetSince).toBe(5000)
  expect(navigationState(context(), catalog(), { ...target, itemId: 99 }, null, null).targetSince).toBe(5000)
  expect(navigationState(context(), catalog(), null, player(), null).targetSince).toBeNull()
})

it('picks the aetheryte nearest in 3D and places it on the map of the treasure', () => {
  const c = catalog()
  // The treasure is at (0, -2, -10): the tower top is 3 m away on the map but 100 m above it.
  c.aetherytes[148] = [
    { id: 1, name: 'Tower top', world: { x: 0, y: 98, z: -13 } },
    { id: 2, name: 'Plain', world: { x: 30, y: -2, z: -10 } },
  ]
  const aetheryte = {
    name: 'Plain',
    distanceM: 30,
    position: { mapId: 4, x: mapCoordinate(30, 0, 100), y: mapCoordinate(-10, 0, 100) },
  }
  expect(navigationState(context(), c, target, player(), null).target?.aetheryte).toEqual(aetheryte)
  expect(navigationState({ ...context(), territoryId: 999 }, c, target, player(), null)).toMatchObject({
    status: 'other-territory',
    target: { aetheryte },
  })
  delete c.maps[4]
  expect(navigationState(context(), c, target, player(), null).target?.aetheryte).toEqual({
    ...aetheryte,
    position: null,
  })
})

it('names no aetheryte without the treasure height or aetheryte positions of its territory', () => {
  const c = catalog()
  expect(navigationState(context(), c, target, player(), null).target?.aetheryte).toBeNull()
  c.aetherytes[999] = [{ id: 1, name: 'Elsewhere', world: { x: 0, y: -2, z: -10 } }]
  expect(navigationState(context(), c, target, player(), null).target?.aetheryte).toBeNull()
  c.aetherytes[148] = c.aetherytes[999]
  expect(navigationState(context(), c, target, player(), null).target?.aetheryte?.name).toBe('Elsewhere')
  c.targets[88][0].world.y = null
  expect(navigationState(context(), c, target, player(), null).target?.aetheryte).toBeNull()
})
