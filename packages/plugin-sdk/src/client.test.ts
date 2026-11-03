import { expect, it, vi } from 'vitest'
import type { Hello } from './client.js'
import { ClientClock } from './clock.js'
import { pluginError } from './errors.js'
import { limitNames, limitsSnapshot } from './limits.js'
import { createTestContext } from './testing.js'
import type { Value } from './types.js'

const hello: Hello = {
  apiVersion: '1.0.0',
  identity: { id: 'Fixture', version: '1.0.0', activationId: 'test', mode: 'worker', environment: 'development' },
  capabilities: { supported: { 'data.read': { state: 'available' } }, granted: ['data.read'] },
  clock: { now: null, base: null, source: null, generation: 0, paused: false },
}
const limits = limitsSnapshot({
  schemaVersion: 1,
  revision: 'test',
  values: Object.fromEntries(limitNames.map((name) => [name, 128])),
})
it.each(['views', 'services'] as const)(
  '%s disposal can be retried after quota failure, and an old disposer cannot remove a new registration',
  async (kind) => {
    const method = kind === 'views' ? 'views.onCommand' : 'services.provide'
    let attempts = 0
    const dispose = vi.fn(() => {
      if (++attempts === 1) throw pluginError('quota_exceeded')
      return null
    })
    const fixture = createTestContext(hello, limits, { [method]: () => 'token', [`${method}.dispose`]: dispose })
    const register = () =>
      kind === 'views'
        ? fixture.context.views.onCommand('slot', () => null)
        : fixture.context.services.provide({ name: 'slot', version: '1.0.0', dataPermissions: [] }, () => null)
    const old = await register()
    await expect(old()).rejects.toMatchObject({ code: 'quota_exceeded' })
    await old()
    const current = await register()
    await old()
    await expect(register()).rejects.toMatchObject({ code: 'invalid_argument' })
    expect(dispose).toHaveBeenCalledTimes(2)
    await current()
    fixture.close()
  },
)
it('keeps binary/bigint intact and signal out of the wire arguments', async () => {
  const read = vi.fn(() => 1n)
  const fixture = createTestContext(hello, limits, { 'data.name': read })
  const result = await fixture.context.data.name('action', 7, 'en', { signal: new AbortController().signal })
  expect(result).toBe(1n)
  expect(fixture.requests).toEqual([{ method: 'data.name', params: { kind: 'action', id: 7, language: 'en' } }])
  fixture.close()
})
it('a fake subscription exercises the real ready/ack/disposal logic', async () => {
  const fixture = createTestContext(hello, limits)
  const listener = vi.fn()
  const subscription = fixture.context.packets.subscribe('ipc', listener, { directions: ['send'] })
  await subscription.ready
  fixture.publish('packets', [{ id: 1n, bytes: Uint8Array.of(3) }])
  for (let i = 0; i < 5; i++) await Promise.resolve()
  expect(listener.mock.calls[0][0].items).toEqual([{ id: 1n, bytes: Uint8Array.of(3) }])
  subscription.dispose()
  fixture.publish('packets', [2n])
  expect(listener).toHaveBeenCalledOnce()
  fixture.close()
})
it('capability snapshots and identity cannot mutate the activation authority', () => {
  const fixture = createTestContext(hello, limits)
  fixture.context.capabilities.get().granted.push('memory.read')
  expect(fixture.context.capabilities.get().granted).toEqual(['data.read'])
  expect(Object.isFrozen(fixture.context.identity)).toBe(true)
  fixture.close()
})
it('clock synchronization never regresses a generation but a reset may change its domain', () => {
  let mono = 100
  const initial = { now: 1000, base: 'host-monotonic-unix', source: 'live', generation: 1, paused: false } as const
  const clock = new ClientClock(initial, () => mono)
  mono = 150
  expect(clock.now()).toBe(1050)
  clock.sync({ ...initial, now: 1020 }, 1)
  expect(clock.now()).toBe(1050)
  mono = 190
  expect(clock.now()).toBe(1060)
  clock.sync({ now: 20, base: 'packet-unix', source: 'replay', generation: 2, paused: true }, 4)
  mono = 900
  expect(clock.now()).toBe(20)
  clock.sync({ now: 30, base: 'packet-unix', source: 'replay', generation: 2, paused: false }, 0)
  mono = 1000
  expect(clock.now()).toBe(30) // max-speed replay must not be extrapolated by wall time.
})

it('reads icon bytes and passes cancellation outside the wire arguments', async () => {
  const value = { mime: 'image/png', width: 2, height: 1, data: Uint8Array.of(137, 80, 78, 71) }
  const fixture = createTestContext(hello, limits, {
    'data.icon': (params) => ((params as { id: Value }).id === 0 ? null : value),
  })
  expect(await fixture.context.data.icon(62001, { signal: new AbortController().signal })).toEqual(value)
  expect(await fixture.context.data.icon(0)).toBeNull()
  expect(fixture.requests).toEqual([
    { method: 'data.icon', params: { id: 62001 } },
    { method: 'data.icon', params: { id: 0 } },
  ])
  fixture.close()
})
it('asks for the version of the game data with no arguments', async () => {
  const fixture = createTestContext(hello, limits, { 'data.version': () => '2026.01.01.0000.0000' })
  expect(await fixture.context.data.version()).toBe('2026.01.01.0000.0000')
  expect(fixture.requests).toEqual([{ method: 'data.version', params: {} }])
  fixture.close()
})
it('submits preference items as one replacing call', async () => {
  const fixture = createTestContext(hello, limits, { 'ui.setPreferenceItems': () => null })
  const items = [{ id: 'color', title: '高亮颜色', description: '' }]
  expect(await fixture.context.ui.setPreferenceItems(items)).toBeUndefined()
  await fixture.context.ui.setPreferenceItems([])
  expect(fixture.requests).toEqual([
    { method: 'ui.setPreferenceItems', params: { items } },
    { method: 'ui.setPreferenceItems', params: { items: [] } },
  ])
  fixture.close()
})
it('leaves an omitted notification detail out of the request', async () => {
  const fixture = createTestContext(hello, limits, { 'notifications.send': () => null })
  expect(await fixture.context.notifications.send({ title: 'a' })).toBeUndefined()
  await fixture.context.notifications.send({ title: 'a', detail: 'b' })
  expect(fixture.requests).toEqual([
    { method: 'notifications.send', params: { title: 'a' } },
    { method: 'notifications.send', params: { title: 'a', detail: 'b' } },
  ])
  fixture.close()
})
it('merges view updates into one views.set call per channel', async () => {
  const fixture = createTestContext(hello, limits, { 'views.set': () => null })
  fixture.context.views.set('state', 1)
  fixture.context.views.set('state', 2)
  await fixture.context.views.flush()
  expect(fixture.requests).toEqual([{ method: 'views.set', params: { channel: 'state', payload: 2 } }])
  fixture.close()
})

it('exposes client bytes and lazy image URLs without putting cancellation on the wire', async () => {
  const image = 'mojito-plugin://runtime/client/test/1/image/ui/icon/test.tex'
  const fixture = createTestContext(hello, limits, {
    'data.resource': () => new Uint8Array([1, 2]),
    'data.image': () => image,
    'data.map': () => null,
  })
  expect(await fixture.context.data.resource('ui/test.bin')).toEqual(new Uint8Array([1, 2]))
  expect(await fixture.context.data.image('ui/icon/test.tex', { signal: new AbortController().signal })).toBe(image)
  expect(await fixture.context.data.map('s1f1/00')).toBeNull()
  expect(fixture.requests).toEqual([
    { method: 'data.resource', params: { path: 'ui/test.bin' } },
    { method: 'data.image', params: { path: 'ui/icon/test.tex' } },
    { method: 'data.map', params: { id: 's1f1/00' } },
  ])
  fixture.close()
})

it('returns a complete ordinary-sheet ID array without pagination parameters', async () => {
  const fixture = createTestContext(hello, limits, { 'data.rowIds': () => [0, 2, 10] })
  expect(await fixture.context.data.rowIds('Map', 'none', { signal: new AbortController().signal })).toEqual([0, 2, 10])
  expect(fixture.requests).toEqual([{ method: 'data.rowIds', params: { sheet: 'Map', language: 'none' } }])
  fixture.close()
})
