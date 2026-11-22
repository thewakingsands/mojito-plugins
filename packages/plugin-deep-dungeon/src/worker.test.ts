import type { ViewIdentity } from '@ffcafe/mojito-plugin-sdk'
import { expect, it } from 'vitest'
import catalog from '../fixtures/catalog.js'
import { entity, fixtureHost, ok } from '../fixtures/host.js'
import { activateCatalog } from './worker.js'

const reference: ViewIdentity = {
  viewId: 'test',
  kind: 'feature',
  definitionId: 'reference',
  instanceId: null,
  placement: 'sidebar',
}
const settingsView: ViewIdentity = { ...reference, definitionId: 'settings', placement: 'settings' }
it('registers the views, publishes target fields, and keeps reference selection independent', async () => {
  const host = fixtureHost()
  const dispose = await activateCatalog(host.ctx, catalog)
  try {
    expect(host.requests.map(({ method, args }) => [method, args[0]])).toEqual([
      [
        'ui.registerOverlay',
        { id: 'target', name: '选中怪物', entry: 'overlay.html', defaultSize: { width: 380, height: 340 } },
      ],
      ['ui.registerFeature', { id: 'reference', name: '深层迷宫图鉴', entry: 'reference.html', placement: 'sidebar' }],
      ['ui.registerFeature', { id: 'settings', name: '深层迷宫图鉴', entry: 'settings.html', placement: 'settings' }],
    ])
    expect(host.snapshots.get('target')).toBeNull()
    expect(host.snapshots.get('display')).toEqual({ settings: { language: 'auto' }, language: 'zhCN' })
    host.publish('zone', { territoryType: ok(900001), mapId: ok(1) })
    host.publish('target', ok(101))
    host.publish('entities', { entities: [entity()], missingIds: [] })
    const before = host.snapshots.get('target')
    expect(await host.commands.get('reference')!({ ids: [910002] }, reference)).toEqual({ language: 'chs', names: {} })
    expect(host.snapshots.get('target')).toBe(before)
    expect(host.requests.some((request) => request.method === 'data.rows')).toBe(false)
    await host.commands.get('display')!({ language: 'en' }, settingsView)
    expect(host.snapshots.get('display')).toEqual({ settings: { language: 'en' }, language: 'en' })
    expect(await host.ctx.config.get('display')).toEqual({ language: 'en' })
    await expect(host.commands.get('display')!({ language: 'en' }, reference)).rejects.toThrow('Settings view required')
    await expect(host.commands.get('reference')!({ ids: [12161] }, reference)).rejects.toThrow('Invalid name IDs')
  } finally {
    await dispose()
  }
  expect(host.subscriptions.every((sub) => sub.disposed)).toBe(true)
  expect(host.commands.size).toBe(0)
})
