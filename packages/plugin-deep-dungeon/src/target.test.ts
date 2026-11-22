import type { CombatantState } from '@ffcafe/mojito-plugin-sdk'
import { afterEach, expect, it, vi } from 'vitest'
import catalog from '../fixtures/catalog.js'
import { batch, entity, fixtureHost, ok, sample } from '../fixtures/host.js'
import { target } from './state.js'
import { watchTarget } from './target.js'

afterEach(() => vi.useRealTimers())
it('projects only the matching battle NPC and keeps valid HP without guide data', () => {
  const mob = entity()
  expect(target(catalog, 'PotD', 101, mob)).toMatchObject({
    nameId: 910001,
    hp: { current: 7500, max: 10000 },
    monster: { nameId: 910001 },
  })
  for (const patch of [
    { id: 102 },
    { objectKind: ok(1) },
    { subKind: ok(2) },
    { subKind: ok(9) },
    { objectKind: { state: 'unknown', reason: 'test' } },
    { subKind: undefined },
  ] satisfies Partial<CombatantState>[])
    expect(target(catalog, 'PotD', 101, { ...mob, ...patch })).toBeNull()
  expect(target(catalog, null, 101, mob)).toBeNull()
  expect(target(catalog, 'PotD', null, mob)).toBeNull()
  expect(target(catalog, 'PotD', 101, null)).toBeNull()
  expect(target(catalog, 'PotD', 101, { ...mob, bNpcName: ok(919999) })).toMatchObject({
    name: '训练石像',
    monster: null,
    hp: { current: 7500 },
  })
  expect(target(catalog, 'PotD', 101, { ...mob, bNpcName: undefined })).toMatchObject({
    nameId: null,
    monster: null,
    hp: { current: 7500 },
  })
  expect(target(catalog, 'PotD', 101, { ...mob, name: undefined })).toMatchObject({
    name: catalog.monsters[0].upstreamName,
  })
  expect(target(catalog, 'PotD', 101, { ...mob, name: undefined, bNpcName: undefined })).toMatchObject({ name: '101' })
})
it('shows zero HP and omits only HP when its fields are unavailable', () => {
  expect(target(catalog, 'PotD', 101, { ...entity(), hpCur: ok(0) })?.hp).toEqual({ current: 0, max: 10000 })
  for (const patch of [
    { hpMax: ok(0) },
    { hpMax: undefined },
    { hpCur: { state: 'unavailable', reason: 'test' } },
  ] satisfies Partial<CombatantState>[])
    expect(target(catalog, 'PotD', 101, { ...entity(), ...patch })).toMatchObject({
      hp: null,
      monster: { nameId: 910001 },
    })
})
it('clears on switches, rejects late or mismatched entities, retries closed input and disposes', async () => {
  vi.useFakeTimers()
  const host = fixtureHost(),
    publish = vi.fn()
  const dispose = watchTarget(host.ctx, catalog, publish)
  host.publish('zone', { territoryType: ok(900001), mapId: ok(1) })
  host.publish('target', ok(101))
  host.publish('entities', { entities: [entity()], missingIds: [] })
  expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ id: 101 }))
  const first = host.subscriptions.find((sub) => sub.topic === 'entities')!
  expect(first.options).toEqual({ ids: [101], fields: ['objectKind', 'subKind', 'name', 'bNpcName', 'hpCur', 'hpMax'] })
  host.publish('target', ok(102))
  expect(first.disposed).toBe(true)
  expect(publish).toHaveBeenLastCalledWith(null)
  first.listener(batch([sample({ entities: [entity()], missingIds: [] })]))
  host.publish('entities', { entities: [entity()], missingIds: [] })
  expect(publish).toHaveBeenLastCalledWith(null)
  host.publish('entities', { entities: [entity(102)], missingIds: [] })
  expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ id: 102 }))
  host.publish('entities', { entities: [], missingIds: [102] })
  expect(publish).toHaveBeenLastCalledWith(null)
  host.publish('target', { state: 'unavailable', reason: 'test' })
  expect(publish).toHaveBeenLastCalledWith(null)
  host.publish('target', ok(101))
  first.listener(batch([sample({ entities: [entity()], missingIds: [] })]))
  expect(publish).toHaveBeenLastCalledWith(null)
  const active = host.subscriptions.findLast((sub) => sub.topic === 'entities')!
  active.close()
  await vi.advanceTimersByTimeAsync(1000)
  expect(active.disposed).toBe(true)
  expect(host.subscriptions.findLast((sub) => sub.topic === 'entities')).not.toBe(active)
  host.publish('entities', { entities: [entity()], missingIds: [] })
  host.publish('zone', { territoryType: ok(1), mapId: ok(1) })
  expect(publish).toHaveBeenLastCalledWith(null)
  expect(host.subscriptions.filter((sub) => sub.topic !== 'zone').every((sub) => sub.disposed)).toBe(true)
  dispose()
  const count = host.subscriptions.length
  await vi.advanceTimersByTimeAsync(2000)
  expect(host.subscriptions).toHaveLength(count)
  expect(host.subscriptions.every((sub) => sub.disposed)).toBe(true)
})
it('clears incomplete and closed target/zone input and accepts the next snapshot', async () => {
  vi.useFakeTimers()
  const host = fixtureHost(),
    publish = vi.fn()
  const dispose = watchTarget(host.ctx, catalog, publish)
  host.publish('zone', { territoryType: ok(900001), mapId: ok(1) })
  host.publish('target', ok(101))
  host.publish('entities', { entities: [entity()], missingIds: [] })
  host.publish('target', ok(101), false)
  expect(publish).toHaveBeenLastCalledWith(null)
  await vi.advanceTimersByTimeAsync(1000)
  host.publish('target', ok(101))
  host.publish('entities', { entities: [entity()], missingIds: [] })
  host.subscriptions.find((sub) => sub.topic === 'zone')!.close()
  await vi.advanceTimersByTimeAsync(1000)
  expect(publish).toHaveBeenLastCalledWith(null)
  host.publish('zone', { territoryType: ok(900001), mapId: ok(1) })
  host.publish('target', ok(101))
  host.publish('entities', { entities: [entity()], missingIds: [] })
  expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ id: 101 }))
  dispose()
})
