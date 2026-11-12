import type {
  Batch,
  BatchListener,
  Capability,
  Json,
  Packet,
  PluginContext,
  Sample,
  SessionSnapshot,
  Subscription,
  Value,
  ViewIdentity,
} from '@ffcafe/mojito-plugin-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activate } from './runtime.js'
import { defaultSettings } from './settings.js'

const { loadClientData } = vi.hoisted(() => ({ loadClientData: vi.fn() }))
vi.mock('./client-data.js', async (original) => {
  const actual = await original<typeof import('./client-data.js')>()
  return {
    ...actual,
    ClientGameData: class {
      load = loadClientData
    },
  }
})
const disposers: (() => void | Promise<void>)[] = []
beforeEach(async () => {
  vi.useFakeTimers()
  const { emptyCatalog } = await import('./client-data.js')
  loadClientData.mockImplementation(async () => {
    const result = emptyCatalog()
    result.notebook = { fish: { 0: 0, 1: 4776 }, spearfish: { 20000: 0, 20001: 20145 } }
    return result
  })
})
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose()
  vi.useRealTimers()
})
async function flush() {
  for (let i = 0; i < 25; i++) await Promise.resolve()
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
function batch<T>(items: T[]): Batch<T> {
  return {
    items,
    subscriptionId: 'sub',
    batchId: 0,
    firstSeq: 0,
    lastSeq: items.length - 1,
    initial: false,
    complete: true,
  }
}
function source(sourceKind: 'live' | 'replay' = 'live', generation = 1): SessionSnapshot {
  return {
    state: sourceKind,
    sessionId: 'source',
    characterGeneration: generation,
    process: sourceKind === 'live' ? { pid: 1, name: 'ffxiv_dx11.exe' } : null,
    build: 'synthetic',
    opcodeVersion: '7.57',
    region: 'cn',
    login: 'logged-in',
    character: { actorId: 1, contentId: 1n },
    uiLanguage: 'chs',
    dataLanguage: 'chs',
    capabilities: {},
    clock: {
      now: 100000,
      base: sourceKind === 'live' ? 'host-monotonic-unix' : 'packet-unix',
      generation: 1,
      source: sourceKind,
      paused: false,
    },
  }
}
function packet(type: string, data: Uint8Array, session: SessionSnapshot, time = 100000): Sample<Packet> {
  return {
    meta: {
      sessionId: session.sessionId!,
      characterGeneration: session.characterGeneration,
      source: session.state === 'replay' ? 'replay' : 'live',
      observedAt: time,
      timeBase: 'packet-unix',
      clockGeneration: session.clock.generation,
      sampleStartedAt: null,
      sampleEndedAt: null,
    },
    value: {
      type,
      data,
      seq: 1,
      timestamp: time,
      direction: 'recv',
      channel: 'zone',
      opcode: 1,
      sourceActor: 1,
      targetActor: 1,
      serverId: 1,
      ipcTimestamp: 1,
    },
  }
}
const view = (kind: 'feature' | 'overlay' = 'feature', definitionId = 'main'): ViewIdentity => ({
  viewId: crypto.randomUUID(),
  kind,
  definitionId,
  instanceId: kind === 'overlay' ? 'overlay' : null,
})
function fixture(
  options: { initial?: SessionSnapshot; settings?: Json; packetsFail?: boolean; sessionsFail?: boolean } = {},
) {
  let current = options.initial ?? source()
  let now = 100000
  let grants = ['session.read', 'packets.read', 'ui.register', 'http.request', 'audio.play', 'data.read']
  const capabilityOverrides: Record<string, Capability> = {}
  let sessionListener!: BatchListener<SessionSnapshot>
  let command!: (value: Value, view: ViewIdentity) => Value | Promise<Value>
  const streams: {
    listener: BatchListener<Sample<Packet>>
    subscription: Subscription
    close(reason: string): void
  }[] = []
  const controller = new AbortController()
  const snapshots: Value[] = [],
    publications: { channel: string; value: Value }[] = []
  const sessionClosed = deferred<{ reason: string }>()
  const sessionDispose = vi.fn(() => sessionClosed.resolve({ reason: 'disposed' }))
  const commandDispose = vi.fn(),
    featureDispose = vi.fn(),
    overlayDispose = vi.fn()
  const configValues = new Map<string, Json>([['settings', options.settings ?? null]])
  const pendingViews = new Map<string, Value>()
  const context = {
    identity: { id: 'Matcha', version: 'test', activationId: 'test', mode: 'worker', environment: 'development' },
    signal: controller.signal,
    capabilities: {
      get: () => ({
        ...Object.fromEntries(grants.map((name) => [name, { state: 'available' }])),
        ...capabilityOverrides,
      }),
    },
    limits: { version: 1, values: { 'storage.fileBytes': 16 * 1024 * 1024 } },
    clock: { now: () => now, state: () => current.clock },
    config: {
      get: vi.fn(async (key: string) => configValues.get(key) ?? null),
      set: vi.fn(async (key: string, value: Json) => {
        configValues.set(key, value)
      }),
    },
    storage: {
      read: vi.fn(async () => new Uint8Array()),
      write: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(async () => []),
    },
    log: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() },
    session: {
      get: vi.fn(async () => structuredClone(current)),
      subscribe: vi.fn((listener: BatchListener<SessionSnapshot>) => {
        sessionListener = listener
        return {
          ready: options.sessionsFail ? Promise.reject(new Error('permission_denied')) : Promise.resolve(),
          closed: sessionClosed.promise,
          dispose: sessionDispose,
        }
      }),
    },
    packets: {
      subscribe: vi.fn((_selector: string, listener: BatchListener<Sample<Packet>>) => {
        const closed = deferred<{ reason: string }>()
        const subscription = {
          ready: options.packetsFail ? Promise.reject(new Error('permission_denied')) : Promise.resolve(),
          closed: closed.promise,
          dispose: vi.fn(() => closed.resolve({ reason: 'disposed' })),
        }
        streams.push({ listener, subscription, close: (reason) => closed.resolve({ reason }) })
        return subscription
      }),
    },
    memory: {
      resolve: vi.fn(async () => {
        throw new Error('unavailable')
      }),
      read: vi.fn(async () => ({})),
    },
    game: {
      getPlayer: vi.fn(async () => {
        throw new Error('unavailable')
      }),
      getCombatants: vi.fn(async () => {
        throw new Error('unavailable')
      }),
    },
    http: {
      request: vi.fn(async (url: string) => ({
        status: 200,
        headers: {},
        body: new TextEncoder().encode('{"spot_id":28,"distributions":[]}'),
        url,
      })),
    },
    data: {
      version: vi.fn(async () => 'test-client'),
      rows: vi.fn(async () => []),
      map: vi.fn(async () => 'mojito-plugin://runtime/map'),
      image: vi.fn(async () => 'mojito-plugin://runtime/icon'),
    },
    notifications: { send: vi.fn(async () => {}) },
    audio: { say: vi.fn(async () => {}), play: vi.fn(async () => {}) },
    host: {
      openExternal: vi.fn(async () => 'cancelled'),
    },
    views: {
      set: vi.fn((channel: string, value: Value) => {
        pendingViews.set(channel, structuredClone(value))
      }),
      flush: vi.fn(async () => {
        for (const [channel, value] of pendingViews) {
          if (channel === 'matcha.state') snapshots.push(value)
          else publications.push({ channel, value })
        }
        pendingViews.clear()
      }),
      onCommand: vi.fn(async (_channel: string, handler: typeof command) => {
        command = handler
        return commandDispose
      }),
    },
    ui: { registerFeature: vi.fn(async () => featureDispose), registerOverlay: vi.fn(async () => overlayDispose) },
  } as unknown as PluginContext
  return {
    context,
    streams,
    controller,
    snapshots,
    publications,
    sessionDispose,
    commandDispose,
    featureDispose,
    overlayDispose,
    get current() {
      return current
    },
    setGrants(value: string[]) {
      grants = value
    },
    setCapability(name: string, capability: Capability) {
      capabilityOverrides[name] = capability
    },
    async session(value: SessionSnapshot) {
      current = value
      await sessionListener(batch([structuredClone(value)]))
      await flush()
    },
    async packet(type: string, bytes: Uint8Array, stream = streams.length - 1, metadata = current) {
      await streams[stream].listener(batch([packet(type, bytes, metadata, now)]))
      await flush()
    },
    async command(value: Value, identity = view()) {
      return await command(value, identity)
    },
    async advance(ms: number) {
      now += ms
      await vi.advanceTimersByTimeAsync(ms)
      await flush()
    },
  }
}
async function start(f: ReturnType<typeof fixture>) {
  const dispose = await activate(f.context)
  disposers.push(dispose)
  await flush()
  return dispose
}
function submarineData(): Uint8Array {
  const data = new Uint8Array(240)
  new DataView(data.buffer).setUint16(2, 120, true)
  return data
}
function fishingData(type: number, animation = 0): Uint8Array {
  const data = new Uint8Array(40),
    v = new DataView(data.buffer)
  v.setUint32(0, 1, true)
  v.setUint32(8, 0x00150001, true)
  v.setUint16(12, type, true)
  v.setUint16(28, animation, true)
  return data
}
function setupData() {
  const data = new Uint8Array(2951)
  data.set(new TextEncoder().encode('角色一'), 0x34c)
  return data
}
function latest(f: ReturnType<typeof fixture>): {
  version: string
  notebook: { characterName: string } | null
  events: { type: string; content: Json }[]
} {
  return f.snapshots.at(-1) as unknown as ReturnType<typeof latest>
}

describe('Matcha runtime lifecycle', () => {
  it('shares the plugin HTTP resource budget across simultaneous plugin views', async () => {
    const f = fixture(),
      gate = deferred<void>()
    await start(f)
    let active = 0,
      peak = 0
    vi.mocked(f.context.http.request).mockImplementation(async (url) => {
      peak = Math.max(peak, ++active)
      await gate.promise
      active--
      return { status: 200, headers: {}, body: new Uint8Array(), url }
    })
    const reads = Array.from({ length: 8 }, (_, index) =>
      f.command(
        { action: 'http', url: 'https://map.ffcafe.cn/assets/data/map.json' },
        view(index % 2 ? 'feature' : 'overlay'),
      ),
    )
    await flush()
    expect(peak).toBe(4)
    gate.resolve()
    await Promise.all(reads)
    expect(peak).toBe(4)
    expect(f.context.http.request).toHaveBeenCalledTimes(8)
  })

  it('flushes successive values on the same channel without coalescing configuration changes', async () => {
    const f = fixture()
    await start(f)
    await Promise.all([
      f.command({ action: 'config.set', key: 'overlay.config:app-minified', value: 'true' }),
      f.command({ action: 'config.set', key: 'overlay.config:market-hq-only', value: 'true' }),
    ])
    expect(f.publications.filter((item) => item.channel === 'matcha.config').map((item) => item.value)).toEqual([
      { key: 'overlay.config:app-minified', value: 'true' },
      { key: 'overlay.config:market-hq-only', value: 'true' },
    ])
  })
  it('uses SDK notifications without a custom host permission', async () => {
    const f = fixture()
    await start(f)
    await expect(f.command({ action: 'test.notification' }, view('feature', 'settings'))).resolves.toBe(true)
    expect(f.context.notifications.send).toHaveBeenCalledWith({ title: 'Matcha', detail: '这是 Matcha 通知测试' })
  })

  it('reports a failed host notification without stopping the worker', async () => {
    const f = fixture()
    vi.mocked(f.context.notifications.send).mockRejectedValue(new Error('unavailable'))
    await start(f)
    await expect(f.command({ action: 'test.notification' }, view('feature', 'settings'))).rejects.toThrow(
      '部分通知不可用',
    )
    await expect(f.command({ action: 'settings.get' }, view('feature', 'settings'))).resolves.toBeDefined()
  })

  it('shares one collector across the settings page and overlay commands and hooks up notebook and submarine state', async () => {
    const f = fixture()
    await start(f)
    expect(latest(f).version).toBe(f.context.identity.version)
    await f.command({ action: 'config.get', key: 'overlay.config:app-minified' }, view())
    await f.command({ action: 'config.get', key: 'overlay.config:app-minified' }, view('overlay', 'matcha'))
    expect(f.context.packets.subscribe).toHaveBeenCalledTimes(1)
    expect(f.context.ui.registerFeature).toHaveBeenCalledTimes(1)
    expect(f.context.ui.registerFeature).toHaveBeenCalledWith({
      id: 'settings',
      name: 'Matcha 设置',
      entry: 'settings.html',
      placement: 'settings',
    })
    expect(f.context.ui.registerOverlay).toHaveBeenCalledTimes(1)
    await f.packet('PlayerSetup', setupData())
    await f.packet('SubmarineStatusList', submarineData())
    expect(latest(f).notebook?.characterName).toBe('角色一')
    expect(latest(f).events.filter((event) => event.type === 'SubmarineStatus')).toHaveLength(4)
    await expect(f.command({ action: 'notebook.export' }, view('overlay', 'matcha'))).rejects.toThrow('设置页面')
    const notebook = (await f.command({ action: 'notebook.export' }, view('feature', 'settings'))) as Uint8Array
    expect(JSON.parse(new TextDecoder().decode(notebook))).toBeTruthy()
  })
  it('clears character state on generation changes and rejects old callbacks and old metadata', async () => {
    const f = fixture()
    await start(f)
    const old = f.current
    await f.packet('PlayerSetup', setupData())
    await f.packet('SubmarineStatusList', submarineData())
    await f.session(source('live', 2))
    expect(f.streams[0].subscription.dispose).toHaveBeenCalled()
    expect(f.context.packets.subscribe).toHaveBeenCalledTimes(2)
    expect(latest(f).notebook).toBeNull()
    expect(latest(f).events.some((event) => event.type === 'SubmarineStatus')).toBe(false)
    await f.packet('PlayerSetup', setupData(), 0, old)
    await f.packet('SubmarineStatusList', submarineData(), 1, old)
    expect(latest(f).notebook).toBeNull()
    expect(latest(f).events.some((event) => event.type === 'SubmarineStatus')).toBe(false)
  })
  it('keeps replay parsing local even when automatic output and community upload are configured', async () => {
    const settings = structuredClone(defaultSettings)
    settings.fishing = { enabled: true }
    settings.webhooks = [
      { id: 'test', name: 'test', event: 'Fishing', type: 'JSON', endpoint: 'https://example.test/hook', headers: {} },
    ]
    const f = fixture({ initial: source('replay'), settings: settings as unknown as Json })
    await start(f)
    await f.packet('EventPlay', fishingData(1))
    await f.packet('EventPlay', fishingData(5, 292))
    await f.advance(61000)
    expect(latest(f).events.some((event) => event.type === 'Fishing')).toBe(true)
    expect(f.context.http.request).not.toHaveBeenCalled()
    expect(f.context.audio.say).not.toHaveBeenCalled()
    expect(f.context.notifications.send).not.toHaveBeenCalled()
  })
  it('restores retained login state without replaying automatic effects from the initial packet batch', async () => {
    const settings = structuredClone(defaultSettings)
    settings.webhooks = [
      {
        id: 'initial',
        name: 'initial',
        event: 'InitialData',
        type: 'JSON',
        endpoint: 'https://example.test/hook',
        headers: {},
      },
    ]
    const f = fixture({ settings: settings as unknown as Json })
    await start(f)
    const initial = batch([packet('PlayerSetup', setupData(), f.current)])
    initial.initial = true
    await f.streams[0].listener(initial)
    await flush()
    expect(latest(f).notebook?.characterName).toBe('角色一')
    expect(f.context.http.request).not.toHaveBeenCalled()
    expect(f.context.audio.say).not.toHaveBeenCalled()
    expect(f.context.notifications.send).not.toHaveBeenCalled()
    // A new live packet still permits the configured effect after initial delivery finishes.
    await f.packet('PlayerSetup', setupData())
    expect(f.context.http.request).toHaveBeenCalledTimes(1)
  })
  it('requests outgoing packets for live collection and omits unsupported sends in replay', async () => {
    const live = fixture()
    await start(live)
    expect(live.context.packets.subscribe).toHaveBeenCalledWith(
      'ipc',
      expect.any(Function),
      expect.objectContaining({ directions: ['recv', 'send'] }),
    )
    const replay = fixture({ initial: source('replay') })
    await start(replay)
    expect(replay.context.packets.subscribe).toHaveBeenCalledWith(
      'ipc',
      expect.any(Function),
      expect.objectContaining({ directions: ['recv'] }),
    )
  })
  it('disposes collectors and registrations and rejects events delivered after stop', async () => {
    const f = fixture(),
      dispose = await start(f)
    await dispose()
    expect(f.sessionDispose).toHaveBeenCalledTimes(1)
    expect(f.streams[0].subscription.dispose).toHaveBeenCalledTimes(1)
    expect(f.commandDispose).toHaveBeenCalledTimes(1)
    expect(f.featureDispose).toHaveBeenCalledTimes(1)
    expect(f.overlayDispose).toHaveBeenCalledTimes(1)
    const publications = f.publications.length
    await f.packet('EventPlay', fishingData(1))
    await f.advance(60000)
    expect(f.publications).toHaveLength(publications)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('cleans up partial activation when session subscription readiness fails', async () => {
    const f = fixture({ sessionsFail: true })
    await expect(activate(f.context)).rejects.toThrow('permission_denied')
    expect(f.sessionDispose).toHaveBeenCalledTimes(1)
    expect(f.commandDispose).toHaveBeenCalledTimes(1)
    expect(f.context.packets.subscribe).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('clears state when packet permission is revoked and reconnects only after it is restored', async () => {
    const f = fixture()
    await start(f)
    await f.packet('PlayerSetup', setupData())
    f.setCapability('packets.read', { state: 'denied' })
    // API 2.0 keeps denied packet subscriptions open but silent.
    await flush()
    await f.advance(1000)
    expect(latest(f).notebook).toBeNull()
    expect(f.context.packets.subscribe).toHaveBeenCalledTimes(1)
    f.setCapability('packets.read', { state: 'available' })
    await f.advance(1000)
    expect(f.context.packets.subscribe).toHaveBeenCalledTimes(2)
  })
  it.each([{ state: 'denied' } as const, { state: 'unavailable', reason: 'No live client' } as const])(
    'starts without packets when the capability is $state and resumes without a session event',
    async (capability) => {
      const f = fixture()
      f.setCapability('packets.read', capability)
      await start(f)
      expect(f.context.packets.subscribe).not.toHaveBeenCalled()
      await expect(f.command({ action: 'settings.get' }, view('feature', 'settings'))).resolves.toBeDefined()
      f.setCapability('packets.read', { state: 'available' })
      await f.advance(1000)
      expect(f.context.packets.subscribe).toHaveBeenCalledTimes(1)
      await f.packet('PlayerSetup', setupData())
      expect(latest(f).notebook?.characterName).toBe('角色一')
    },
  )
  it('discards retained identity data when identity permission changes without a session event', async () => {
    const f = fixture()
    f.setCapability('identity.read', { state: 'available' })
    await start(f)
    await f.packet('PlayerSetup', setupData())
    f.setCapability('identity.read', { state: 'denied' })
    await f.advance(1000)
    expect(latest(f).notebook).toBeNull()
    expect(f.streams[0].subscription.dispose).toHaveBeenCalled()
    await f.packet('PlayerSetup', setupData(), 0)
    expect(latest(f).notebook).toBeNull()
  })
  it('reports a failed packet subscription and disposes the failed registration without retry loops', async () => {
    const f = fixture({ packetsFail: true })
    await start(f)
    expect(f.context.log.warn).toHaveBeenCalledWith(expect.stringContaining('订阅'))
    expect(f.streams[0].subscription.dispose).toHaveBeenCalled()
    await f.advance(3000)
    expect(f.context.packets.subscribe).toHaveBeenCalledTimes(1)
  })
  it('does not continue publishing an old character batch after stop during a pending flush', async () => {
    const f = fixture(),
      dispose = await start(f),
      blocked = deferred<void>()
    vi.mocked(f.context.views.flush).mockImplementationOnce(() => blocked.promise)
    await f.streams[0].listener(batch([packet('SubmarineStatusList', submarineData(), f.current)]))
    await flush()
    const publications = f.publications.length
    await dispose()
    blocked.resolve()
    await flush()
    expect(f.publications).toHaveLength(publications)
  })
})

it('returns client map and icon URLs through the image API without HTTP', async () => {
  const f = fixture()
  await start(f)
  expect(await f.command({ action: 'map.image', id: 's1f1/00' })).toBe('mojito-plugin://runtime/map')
  expect(f.context.data.map).toHaveBeenCalledWith('s1f1/00')
  expect(await f.command({ action: 'map.icon', id: 60561 })).toBe('mojito-plugin://runtime/icon')
  expect(f.context.data.image).toHaveBeenCalledWith('ui/icon/060000/060561.tex')
  await expect(f.command({ action: 'map.icon', id: -1 })).rejects.toThrow('无效图标ID')
  vi.mocked(f.context.data.image).mockResolvedValueOnce(null)
  expect(await f.command({ action: 'map.icon', id: 1 })).toBeNull()
  vi.mocked(f.context.data.map).mockRejectedValueOnce(new Error('permission_denied'))
  await expect(f.command({ action: 'map.image', id: 's1f1/00' })).rejects.toThrow('permission_denied')
  expect(f.context.http.request).not.toHaveBeenCalled()
})

it('requires local data permission for item commands and rejects invalid item IDs', async () => {
  const f = fixture()
  f.setGrants(['session.read', 'packets.read', 'ui.register'])
  await start(f)
  await expect(f.command({ action: 'item.get', ids: [42] })).rejects.toThrow('permission_denied')
  expect(f.context.data.rows).not.toHaveBeenCalled()
  f.setGrants(['session.read', 'packets.read', 'ui.register', 'data.read'])
  await expect(f.command({ action: 'item.get', ids: [-1] })).rejects.toThrow('无效物品编号')
  expect(await f.command({ action: 'item.get', ids: [42] })).toEqual([])
  expect(f.context.data.rows).toHaveBeenCalledWith('Item', [42], 'chs', expect.anything())
  expect(f.context.http.request).not.toHaveBeenCalled()
})

it('reloads client catalogs when the game data version or language changes', async () => {
  const f = fixture()
  await start(f)
  expect(loadClientData).toHaveBeenCalledTimes(1)
  await f.command({ action: 'catalog' })
  expect(loadClientData).toHaveBeenCalledTimes(1)
  vi.mocked(f.context.data.version).mockResolvedValue('new-client')
  await f.advance(1000)
  expect(loadClientData).toHaveBeenCalledTimes(2)
  await f.session({ ...f.current, dataLanguage: 'en' })
  await f.command({ action: 'data.catalog' })
  expect(loadClientData).toHaveBeenLastCalledWith('en', expect.any(AbortSignal))
})
it('discards client catalogs that finish after a source change', async () => {
  const f = fixture()
  await start(f)
  const { emptyCatalog } = await import('./client-data.js')
  const gate = deferred<ReturnType<typeof emptyCatalog>>()
  loadClientData.mockImplementationOnce(() => gate.promise)
  vi.mocked(f.context.data.version).mockResolvedValue('new-client')
  const loading = f.command({ action: 'data.catalog' })
  const rejected = expect(loading).rejects.toThrow('stale_session')
  await flush()
  await f.session({ ...f.current, dataLanguage: 'en' })
  const old = emptyCatalog()
  old.fates[999] = { name: { chs: 'old' }, level: 1, patch: 2, location: 148 }
  gate.resolve(old)
  await rejected
  const current = await f.command({ action: 'catalog' })
  expect(current).not.toHaveProperty('fates.999')
})

it('keeps settings available when client data is unavailable and does not return stale tables', async () => {
  const f = fixture()
  loadClientData.mockRejectedValue(new Error('unavailable'))
  await start(f)
  await expect(f.command({ action: 'catalog' })).resolves.toMatchObject({
    fates: {},
    templates: [],
    dataError: '客户端游戏资料暂不可用',
  })
  await expect(f.command({ action: 'settings.get' }, view('feature', 'settings'))).resolves.toBeDefined()
})
