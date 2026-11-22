import type {
  Batch,
  BatchListener,
  CombatantState,
  GameEvent,
  GameTopics,
  Json,
  PlayerState,
  PluginContext,
  Sample,
  SessionSnapshot,
  Subscription,
} from '@ffcafe/mojito-plugin-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EurekaState } from './eureka-types.js'
import { ExplorationService } from './service.js'
import type { ExplorationCatalog, HuntState, LocationState, NavigationState } from './types.js'

const cleanup: (() => void)[] = []
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn()
  vi.useRealTimers()
})
const batch = <T>(items: T[], complete = true): Batch<T> => ({
  subscriptionId: 'test',
  batchId: 1,
  firstSeq: 1,
  lastSeq: 1,
  initial: false,
  complete,
  items,
})
const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}
function fixture() {
  let now = 10000
  const session: SessionSnapshot = {
    state: 'live',
    sessionId: 'test-source',
    characterGeneration: 1,
    process: null,
    build: 'synthetic',
    opcodeVersion: null,
    region: null,
    login: 'logged-in',
    character: null,
    uiLanguage: 'en',
    dataLanguage: 'en',
    capabilities: {},
    clock: { now, base: 'host-monotonic-unix', generation: 1, source: 'live', paused: false },
  }
  const clock = () => ({ ...session.clock, now })
  const sample = <T>(value: T): Sample<T> => ({
    value,
    meta: {
      sessionId: session.sessionId!,
      characterGeneration: session.characterGeneration,
      clockGeneration: session.clock.generation,
      source: 'live',
      observedAt: now,
      timeBase: 'host-monotonic-unix',
      sampleStartedAt: now,
      sampleEndedAt: now,
    },
  })
  const field = <T>(value: T, observedAt = now) => ({
    state: 'ok' as const,
    value,
    observedAt,
    timeBase: 'host-monotonic-unix' as const,
    from: 'memory' as const,
  })
  const actor = (observedAt = now): CombatantState => ({
    id: 7,
    objectKind: field(2),
    bNpcBase: field(10),
    bNpcName: field(11),
    position: field({ x: 10, y: 20, z: 30 }, observedAt),
    hpCur: field(100),
    hpMax: field(100),
  })
  let eventListener!: BatchListener<Sample<GameEvent<'zoneChanged'>>>
  let zoneListener!: BatchListener<Sample<GameTopics['zone']>>
  const streams: { subscription: Subscription; close: (value: { reason: string }) => void }[] = []
  const subscribe = () => {
    const closed = deferred<{ reason: string }>()
    const subscription: Subscription = {
      ready: Promise.resolve(),
      closed: closed.promise,
      dispose: vi.fn(() => closed.resolve({ reason: 'disposed' })),
    }
    streams.push({ subscription, close: closed.resolve })
    return subscription
  }
  const grants: Record<string, { state: 'available' | 'unavailable' }> = {
    'game.read': { state: 'available' },
    'events.read': { state: 'available' },
    'packets.read': { state: 'available' },
  }
  const controller = new AbortController()
  const context = {
    signal: controller.signal,
    clock: { now: () => now, state: clock },
    capabilities: { get: () => grants },
    limits: { values: { 'game.watchMinMs': 1000, 'game.watchMaxMs': 10000 } },
    events: {
      subscribe: vi.fn((_type, listener) => {
        eventListener = listener
        return subscribe()
      }),
    },
    game: {
      subscribe: vi.fn((_topic, listener) => {
        zoneListener = listener
        return subscribe()
      }),
      getPlayer: vi.fn(
        async (): Promise<Sample<PlayerState>> =>
          sample({ actorId: field(1), position: field({ x: 0, y: 0, z: 0 }), rotation: field(0) }),
      ),
      getCombatants: vi.fn(async () => sample({ entities: [actor()], missingIds: [] })),
    },
  } as unknown as PluginContext
  const catalog: ExplorationCatalog = {
    maps: { 1: { mapId: 1, name: 'Test zone', offset: [0, 0], sizeFactor: 100 } },
    territoryMaps: { 100: 1 },
    territoryDefaults: { 100: { mapId: 1, maps: 1 } },
    territoryKinds: { 100: 'field' },
    aetherytes: {},
    targets: {
      9: [
        {
          itemId: 9,
          spotIndex: 0,
          levelId: 2,
          territoryId: 100,
          mapId: 1,
          placeName: 'Test zone',
          x: 20,
          y: 20,
          z: 0,
          zStatus: 'known',
          world: { x: 10, y: 0, z: 10 },
        },
      ],
    },
    hunts: [{ bNpcBase: 10, bNpcName: 11, name: 'Synthetic hunt', rank: 'A' }],
    huntsAvailable: true,
    heightAvailable: true,
    eureka: {},
    mapIssues: {},
  }
  const values = new Map<string, Json>(),
    publish = vi.fn((type: string, content: Json) => values.set(type, content))
  const service = new ExplorationService({
    context,
    session: () => session,
    catalog: () => catalog,
    catalogRevision: () => 1,
    publish,
  })
  service.start()
  cleanup.push(() => service.dispose())
  const zone = async (id = 100) => {
    await flush()
    await zoneListener(batch([sample({ territoryType: field(id), mapId: field(1) })]))
  }
  const changed = async (id = 100, seq = 2, packetTime = now) => {
    await eventListener(
      batch([
        sample({
          type: 'zoneChanged',
          data: { territoryTypeId: id },
          packet: { seq, timestamp: packetTime, sourceActorId: 0, targetActorId: 0 },
        }),
      ]),
    )
  }
  const advance = async (ms: number) => {
    now += ms
    await vi.advanceTimersByTimeAsync(ms)
    await flush()
  }
  return {
    service,
    catalog,
    context,
    session,
    grants,
    publish,
    values,
    sample,
    actor,
    zone,
    changed,
    advance,
    streams,
    setNow: (time: number) => {
      now = time
    },
    clockNow: () => now,
  }
}

describe('shared exploration collection', () => {
  it('accepts the host timestamp and preserves a fresh position through a missing sample', async () => {
    const f = fixture()
    const seen = 10300
    const sample = f.sample({
      actorId: { state: 'ok', value: 1, observedAt: seen, timeBase: 'host-monotonic-unix', from: 'memory' },
      position: {
        state: 'ok',
        value: { x: 0, y: 0, z: 0 },
        observedAt: seen,
        timeBase: 'host-monotonic-unix',
        from: 'memory',
      },
    } satisfies PlayerState)
    sample.meta.observedAt = seen
    const query = vi.mocked(f.context.game.getPlayer)
    query.mockResolvedValueOnce(sample).mockRejectedValue(new Error('transient sampling failure'))
    await f.zone()
    f.service.treasure(9, 0, 1000)
    await f.advance(250)
    expect(f.values.get('NavigationState')).toMatchObject({ status: 'ready', player: { observedAt: seen } })
    await f.advance(500)
    expect(f.values.get('NavigationState')).toMatchObject({ status: 'ready', player: { observedAt: seen } })
    await f.advance(1750)
    expect(f.values.get('NavigationState')).toMatchObject({ status: 'unavailable', player: null })
  })

  it('clears the navigation target when the game reports an empty treasure slot', async () => {
    const f = fixture()
    await f.zone()
    f.service.treasure(9, 0, 1000)
    await f.advance(500)
    expect((f.values.get('NavigationState') as unknown as NavigationState).target).not.toBeNull()
    f.service.treasure(0, 0, 2000)
    expect(f.values.get('NavigationState')).toMatchObject({ status: 'no-target', target: null, player: null })
  })

  it('bounds queries independently of view count and respects zone subscription limits', async () => {
    const f = fixture()
    await f.zone()
    await f.advance(1000)
    expect(f.context.game.getPlayer).toHaveBeenCalledTimes(4)
    expect(f.context.game.getCombatants).toHaveBeenCalledTimes(2)
    expect(f.context.game.subscribe).toHaveBeenCalledWith(
      'zone',
      expect.any(Function),
      expect.objectContaining({ intervalMs: 1000 }),
    )
    f.service.start()
    await f.advance(1000)
    expect(f.context.events.subscribe).toHaveBeenCalledTimes(1)
    expect(f.context.game.getPlayer).toHaveBeenCalledTimes(8)
  })

  it('does not overlap slow queries and rejects their results after a same-zone boundary', async () => {
    const f = fixture(),
      pending = deferred<Sample<PlayerState>>()
    vi.mocked(f.context.game.getPlayer).mockReturnValueOnce(pending.promise)
    await f.zone()
    f.service.treasure(9, 0, 1000)
    await f.advance(1000)
    expect(f.context.game.getPlayer).toHaveBeenCalledTimes(1)
    const old = f.sample({
      position: {
        state: 'ok' as const,
        value: { x: 9, y: 0, z: 9 },
        observedAt: 11000,
        timeBase: 'host-monotonic-unix' as const,
        from: 'memory' as const,
      },
    })
    await f.changed()
    await f.zone()
    pending.resolve(old)
    await flush()
    expect((f.values.get('NavigationState') as unknown as NavigationState).player).toBeNull()
    await f.advance(250)
    expect((f.values.get('NavigationState') as unknown as NavigationState).status).toBe('ready')
  })

  it('keeps stale cached positions historical even inside a successful new snapshot', async () => {
    const f = fixture()
    vi.mocked(f.context.game.getCombatants).mockImplementation(async () =>
      f.sample({ entities: [f.actor(10000)], missingIds: [] }),
    )
    await f.zone()
    await f.advance(500)
    expect((f.values.get('HuntState') as unknown as HuntState).entries[0]?.state).toBe('observed')
    await f.advance(2001)
    const entry = (f.values.get('HuntState') as unknown as HuntState).entries[0]!
    expect(entry.state).toBe('last-seen')
    expect(entry.lastObservedAt).toBe(10000)
    expect(entry.distanceM).toBeNull()
  })

  it('clears hunt history on structured reentry without raw packet permission', async () => {
    const f = fixture()
    f.grants['packets.read'] = { state: 'unavailable' }
    await f.zone()
    await f.advance(500)
    expect((f.values.get('HuntState') as unknown as HuntState).entries).toHaveLength(1)
    await f.changed()
    expect((f.values.get('HuntState') as unknown as HuntState).entries).toHaveLength(0)
    expect((f.values.get('HuntState') as unknown as HuntState).context.zoneEpoch).toBe(1)
  })

  it('uses source observation time rather than a shifted packet timestamp for reentry', async () => {
    const f = fixture()
    await f.zone()
    f.service.treasure(9, 0, 1000)
    await f.advance(500)
    await f.changed(100, 2, 9000000)
    await f.zone()
    await f.advance(500)
    expect((f.values.get('NavigationState') as unknown as NavigationState).status).toBe('ready')
  })

  it('discards old character queries and stops publishing after disposal', async () => {
    const f = fixture(),
      pending = deferred<Sample<PlayerState>>()
    vi.mocked(f.context.game.getPlayer).mockReturnValueOnce(pending.promise)
    await f.zone()
    f.service.treasure(9, 0, 1000)
    await f.advance(250)
    const old = f.sample({
      position: {
        state: 'ok' as const,
        value: { x: 1, y: 1, z: 1 },
        observedAt: 10250,
        timeBase: 'host-monotonic-unix' as const,
        from: 'memory' as const,
      },
    })
    f.session.characterGeneration++
    await f.advance(250)
    pending.resolve(old)
    await flush()
    expect((f.values.get('NavigationState') as unknown as NavigationState).target).toBeNull()
    f.service.dispose()
    const count = f.publish.mock.calls.length
    await f.advance(1000)
    expect(f.publish).toHaveBeenCalledTimes(count)
  })

  it('pauses on a conflicting zone snapshot until the structured boundary arrives', async () => {
    const f = fixture()
    await f.zone()
    f.service.treasure(9, 0, 1000)
    await f.advance(500)
    const epoch = (f.values.get('NavigationState') as unknown as NavigationState).context.zoneEpoch
    await f.zone(101)
    const state = f.values.get('NavigationState') as unknown as NavigationState
    expect(state.context.territoryId).toBeNull()
    expect(state.context.zoneEpoch).toBe(epoch)
    expect(state.player).toBeNull()
  })

  it('recovers only post-boundary FATEs when packet and zone streams arrive in reverse order', async () => {
    const f = fixture()
    f.catalog.eureka[732] = {
      mapId: 1,
      fates: [{ id: 1332, name: 'Synthetic NM', position: null }],
      weatherRates: null,
      weatherNames: new Map(),
    }
    await f.zone(732)
    f.service.observeFate({ kind: 'start', fateId: 1332, packetSeq: 9, timestamp: 10000 })
    await f.advance(500)
    f.service.observeFate({ kind: 'progress', fateId: 1332, packetSeq: 11, timestamp: 10500, progress: 42 }, 10)
    expect((f.values.get('EurekaState') as unknown as EurekaState).entries[0]?.progress).toBeNull()
    await f.changed(732, 10)
    await f.zone(732)
    const entry = (f.values.get('EurekaState') as unknown as EurekaState).entries[0]!
    expect(entry.activity).toBe('active')
    expect(entry.cooldown.referenceAt).toBe(10500)
    f.service.observeFate({ kind: 'end', fateId: 1332, packetSeq: 12, timestamp: 999999, extra: 0 })
    expect((f.values.get('EurekaState') as unknown as EurekaState).entries[0]?.activity).toBe('active')
  })

  it('accepts a FATE packet observed slightly after the worker clock', async () => {
    const f = fixture()
    f.catalog.eureka[732] = {
      mapId: 1,
      fates: [{ id: 1332, name: 'Synthetic NM', position: null }],
      weatherRates: null,
      weatherNames: new Map(),
    }
    await f.zone(732)
    // The host observed the packet 30 ms after the time the worker's clock has reached.
    f.service.observeFate({ kind: 'start', fateId: 1332, packetSeq: 9, timestamp: 10030 })
    await f.advance(1000)
    expect((f.values.get('EurekaState') as unknown as EurekaState).entries[0]?.activity).toBe('active')
  })

  it('shows a hunt target whose sample is newer than the worker clock as observed', async () => {
    const f = fixture()
    vi.mocked(f.context.game.getCombatants).mockImplementation(async () =>
      f.sample({ entities: [f.actor(f.clockNow() + 30)], missingIds: [] }),
    )
    await f.zone()
    await f.advance(500)
    expect((f.values.get('HuntState') as unknown as HuntState).entries[0]).toMatchObject({ state: 'observed' })
  })

  it('keeps the hunt targets through one failed read and lets them expire by age', async () => {
    const f = fixture()
    await f.zone()
    await f.advance(500)
    expect((f.values.get('HuntState') as unknown as HuntState).entries[0]).toMatchObject({ state: 'observed' })
    vi.mocked(f.context.game.getCombatants).mockRejectedValue(new Error('transient sampling failure'))
    await f.advance(500)
    expect((f.values.get('HuntState') as unknown as HuntState).entries[0]).toMatchObject({ state: 'observed' })
    await f.advance(2500)
    expect((f.values.get('HuntState') as unknown as HuntState).entries[0]).toMatchObject({ state: 'last-seen' })
  })

  it('does not publish the FATE removal burst preceding an island exit as completed NM rounds', async () => {
    const f = fixture()
    f.catalog.eureka[732] = {
      mapId: 1,
      fates: [1332, 1333].map((id) => ({ id, name: `NM ${id}`, position: null })),
      weatherRates: null,
      weatherNames: new Map(),
    }
    const state = () => f.values.get('EurekaState') as unknown as EurekaState
    await f.zone(732)
    f.service.observeFate({ kind: 'end', fateId: 1332, packetSeq: 9, timestamp: 10000, extra: 0 })
    f.service.observeFate({ kind: 'end', fateId: 1333, packetSeq: 10, timestamp: 10000, extra: 0 })
    await f.advance(800)
    expect(state().entries.map((entry) => entry.activity)).toEqual(['unknown', 'unknown'])
    await f.changed(628, 12)
    await f.zone(628)
    await f.advance(2250)
    expect(state()).toMatchObject({ status: 'outside', entries: [] })
    await f.changed(732, 13)
    await f.zone(732)
    expect(state().entries.map((entry) => entry.activity)).toEqual(['unknown', 'unknown'])
  })

  it('clears dynamic state when the structured event stream closes', async () => {
    const f = fixture()
    await f.zone()
    f.service.treasure(9, 0, 1000)
    await f.advance(500)
    expect((f.values.get('NavigationState') as unknown as NavigationState).player).not.toBeNull()
    f.streams[0]!.close({ reason: 'source_incomplete' })
    await flush()
    expect((f.values.get('NavigationState') as unknown as NavigationState).player).toBeNull()
    expect((f.values.get('HuntState') as unknown as HuntState).entries).toHaveLength(0)
  })
})

describe('current location', () => {
  const location = (f: ReturnType<typeof fixture>) => f.values.get('LocationState') as unknown as LocationState
  const locations = (f: ReturnType<typeof fixture>) =>
    f.publish.mock.calls.filter(([type]) => type === 'LocationState').length

  it('is published without a treasure map and survives one failed read', async () => {
    const f = fixture()
    await f.zone()
    await f.advance(250)
    expect(f.values.get('NavigationState')).toMatchObject({ status: 'no-target', target: null })
    const ready = location(f)
    expect(ready).toMatchObject({
      status: 'ready',
      territoryId: 100,
      mapId: 1,
      floorConfirmed: true,
      kind: 'field',
      player: { x: 21.5, y: 21.5, headingDegrees: 180 },
    })
    vi.mocked(f.context.game.getPlayer).mockRejectedValueOnce(new Error('transient sampling failure'))
    await f.advance(250)
    expect(f.context.game.getPlayer).toHaveBeenCalledTimes(2)
    expect(location(f)).toBe(ready)
  })

  it('is cleared first on a zone change and then shows the position in the new zone', async () => {
    const f = fixture()
    f.catalog.maps[2] = { mapId: 2, name: 'Next zone', offset: [100, 0], sizeFactor: 100 }
    f.catalog.territoryDefaults[101] = { mapId: 2, maps: 1 }
    f.catalog.territoryKinds[101] = 'town'
    await f.zone()
    f.service.treasure(9, 0, 1000)
    await f.advance(500)
    expect(location(f).player).not.toBeNull()
    f.publish.mockClear()
    await f.changed(101)
    expect(f.publish.mock.calls.map(([type]) => type)).toEqual([
      'LocationState',
      'NavigationState',
      'HuntState',
      'EurekaState',
    ])
    expect(location(f)).toMatchObject({ context: { zoneEpoch: 1 }, territoryId: null, mapId: null, player: null })
    f.publish.mockClear()
    await f.zone(101)
    expect(f.publish.mock.calls[0]?.[0]).toBe('LocationState')
    expect(location(f)).toMatchObject({ territoryId: 101, mapId: 2, kind: 'town', player: null })
    await f.advance(250)
    expect(location(f)).toMatchObject({ status: 'ready', mapId: 2, player: { x: 23.501953125, y: 21.5 } })
  })

  it('is not republished for unchanged samples and expires once when sampling stops', async () => {
    const f = fixture()
    await f.zone()
    await f.advance(250)
    const published = locations(f)
    await f.advance(1000)
    expect(f.context.game.getPlayer).toHaveBeenCalledTimes(5)
    expect(locations(f)).toBe(published)
    vi.mocked(f.context.game.getPlayer).mockRejectedValue(new Error('sampling stopped'))
    await f.advance(1750)
    expect(location(f).player).not.toBeNull()
    await f.advance(1500)
    expect(locations(f)).toBe(published + 1)
    expect(location(f)).toMatchObject({ status: 'unavailable', mapId: 1, floorConfirmed: true, player: null })
  })
})

describe('treasure map start time', () => {
  const since = (f: ReturnType<typeof fixture>) =>
    (f.values.get('NavigationState') as unknown as NavigationState).targetSince

  it('survives repeated reports and restarts after the map is cleared or the character changes', async () => {
    const f = fixture()
    await f.zone()
    expect(since(f)).toBeNull()
    f.service.treasure(9, 0, 1000)
    expect(since(f)).toBe(1000)
    f.service.treasure(9, 0, 2000)
    expect(since(f)).toBe(1000)
    f.service.treasure(0, 0, 3000)
    expect(since(f)).toBeNull()
    f.service.treasure(9, 0, 4000)
    expect(since(f)).toBe(4000)
    f.session.characterGeneration++
    await f.advance(250)
    expect(since(f)).toBeNull()
    f.service.treasure(9, 0, 5000)
    expect(since(f)).toBe(5000)
    f.service.treasure(9, 1, 6000)
    expect(since(f)).toBe(6000)
  })
})
