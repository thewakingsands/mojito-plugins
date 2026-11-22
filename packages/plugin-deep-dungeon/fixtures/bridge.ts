import type { Value, ViewIdentity } from '@ffcafe/mojito-plugin-sdk'
import type { ViewBridge } from '@ffcafe/mojito-plugin-sdk/view'
import { activateCatalog } from '../src/worker.js'
import catalog from './catalog.js'
import { batch, entity, fixtureHost, ok } from './host.js'

export async function connectView(): Promise<ViewBridge> {
  const host = fixtureHost()
  const dispose = await activateCatalog(host.ctx, catalog)
  const page = document.body.dataset.page ?? 'reference'
  const identity: ViewIdentity = {
    viewId: 'synthetic',
    kind: page === 'overlay' ? 'overlay' : 'feature',
    definitionId: page === 'overlay' ? 'target' : page,
    instanceId: null,
    placement: page === 'settings' ? 'settings' : 'sidebar',
  }
  const banner = document.createElement('aside')
  banner.textContent = '合成资料 · 仅用于页面验收'
  banner.style.cssText =
    'padding:8px 12px;color:var(--mojito-warn-fg);background:var(--mojito-warn-bg);font-size:var(--mojito-text-xs);margin-bottom:12px'
  document.body.prepend(banner)
  const select = (nameId: number | null) => {
    host.publish('target', ok(nameId === null ? null : 101))
    if (nameId !== null) {
      const mob = catalog.monsters.find((item) => item.nameId === nameId)
      host.publish('entities', {
        entities: [{ ...entity(101, nameId), name: ok(mob?.upstreamName ?? '未知的训练怪') }],
        missingIds: [],
      })
    }
  }
  host.publish('zone', { territoryType: ok(900001), mapId: ok(1) })
  select(910001)
  Object.assign(window, { deepDungeonFixture: { select, host } })
  window.addEventListener(
    'pagehide',
    () => {
      void dispose()
    },
    { once: true },
  )
  return {
    identity,
    snapshot: async (channel) => host.snapshots.get(channel) ?? null,
    subscribe(channel, listener) {
      const receive = (value: Value) => {
        void listener(batch([value]))
      }
      const list = host.watchers.get(channel) ?? new Set()
      host.watchers.set(channel, list)
      list.add(receive)
      queueMicrotask(() => receive(host.snapshots.get(channel) ?? null))
      return {
        ready: Promise.resolve(),
        closed: new Promise(() => {}),
        dispose: () => {
          list.delete(receive)
        },
      }
    },
    command: async (channel, value) => host.commands.get(channel)!(value, identity),
    on: () => () => {},
  }
}
