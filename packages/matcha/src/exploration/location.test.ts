import { expect, it } from 'vitest'
import { catalog, context, field, player } from './fixtures.test-helper.js'
import { locationState } from './location.js'

const { clock: _, ...published } = context()
it('places the player on the only map of a territory without a clock or a sample time', () => {
  const state = locationState(context(), catalog(), player())
  expect(state).toEqual({
    context: published,
    status: 'ready',
    reason: null,
    territoryId: 148,
    mapId: 4,
    floorConfirmed: true,
    kind: 'field',
    player: { x: 21.5, y: 21.5, headingDegrees: 180 },
  })
  expect(state.context).not.toHaveProperty('clock')
  expect(state.player).not.toHaveProperty('observedAt')
  const later = player()
  later.actorId = field(1, 10500)
  later.position = field({ x: 0, y: 0, z: 0 }, 10500)
  later.rotation = field(0, 10500)
  expect(locationState(context(10500), catalog(), later)).toEqual(state)
})

it('keeps the map and drops the player once the position expires', () => {
  const p = player()
  p.rotation = field(0, 7000)
  expect(locationState(context(), catalog(), p).player).toEqual({ x: 21.5, y: 21.5, headingDegrees: null })
  expect(locationState(context(12001), catalog(), p)).toMatchObject({
    status: 'unavailable',
    reason: '本人位置不可用',
    mapId: 4,
    floorConfirmed: true,
    player: null,
  })
})

it('shows the default map of a multi-map territory without the player', () => {
  const c = catalog()
  c.maps[515] = { mapId: 515, name: 'Hydatos', resource: 'z3fd/01', sizeFactor: 100, offset: [0, 475] }
  c.maps[520] = { mapId: 520, name: 'Arsenal', resource: 'z3fd/02', sizeFactor: 200, offset: [0, -754] }
  c.territoryDefaults[827] = { mapId: 515, maps: 2 }
  c.territoryKinds[827] = 'eureka'
  expect(locationState({ ...context(), territoryId: 827 }, c, player())).toEqual({
    context: { ...published, territoryId: 827 },
    status: 'unavailable',
    reason: '当前所在的地图未确认',
    territoryId: 827,
    mapId: 515,
    floorConfirmed: false,
    kind: 'eureka',
    player: null,
  })
})

it('reports a territory without a default map as unavailable', () => {
  const c = catalog()
  c.territoryDefaults[148] = { mapId: null, maps: 2 }
  const unavailable = {
    status: 'unavailable',
    reason: '区域地图关联尚未确认',
    territoryId: 148,
    mapId: null,
    floorConfirmed: false,
    kind: 'field',
    player: null,
  }
  expect(locationState(context(), c, player())).toMatchObject(unavailable)
  c.territoryDefaults[148] = { mapId: null, maps: 0 }
  expect(locationState(context(), c, player())).toMatchObject(unavailable)
})

it('waits for the territory and the client catalog', () => {
  const waiting = { status: 'waiting', mapId: null, floorConfirmed: false, kind: null, player: null }
  expect(locationState({ ...context(), territoryId: null }, catalog(), player())).toMatchObject({
    ...waiting,
    territoryId: null,
    reason: '等待当前区域',
  })
  expect(locationState(context(), null, player())).toMatchObject({
    ...waiting,
    territoryId: 148,
    reason: '等待客户端资料',
  })
})
