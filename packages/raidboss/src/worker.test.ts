import type { Batch, PluginContext, Sample, SourceMeta, Value } from '@ffcafe/mojito-plugin-sdk'
import { expect, it, vi } from 'vitest'
import { activateRaidboss } from './worker'

const meta: SourceMeta = {
  sessionId: 'test',
  characterGeneration: 1,
  clockGeneration: 1,
  observedAt: 100000,
  source: 'replay',
  timeBase: 'packet-unix',
  sampleStartedAt: null,
  sampleEndedAt: null,
}
const field = <T>(value: T) => ({
  state: 'ok' as const,
  value,
  from: 'memory' as const,
  observedAt: meta.observedAt,
  timeBase: meta.timeBase,
})
const batch = <T>(value: T): Batch<T> => ({
  subscriptionId: 'test',
  batchId: 1,
  firstSeq: 1,
  lastSeq: 1,
  initial: false,
  complete: true,
  items: [value],
})
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}
it('starts the ordinary Worker, shares output across views, rejects revision conflicts and cancels audio on disable', async () => {
  let event!: (value: Batch<Sample<any>>) => void, latest: any, commands!: (value: Value) => any
  const catalogs: any[] = []
  const game: Record<string, unknown> = {
    entities: { entities: [{ id: 1, name: field('Player'), classJob: field(19) }], missingIds: [] },
    player: { name: field('Player'), classJob: field(19), hpCur: field(100), inCombat: field(true) },
    party: {
      isInParty: field(true),
      // Member 2 is never in entity range; the engine must still start.
      members: field([
        { id: 1, name: 'Player', slot: 0, ownParty: true },
        { id: 2, name: 'Away', slot: 1, ownParty: true },
      ]),
    },
    zone: { territoryType: field(1), mapId: field(1) },
  }
  const callbacks: Record<string, (value: any) => void> = {}
  let closeEvents!: (value: any) => void
  let eventSubscriptions = 0
  let now = 100000,
    paused = false,
    generation = 1
  let updateSession!: (value: Batch<any>) => void
  const timers = new Map<() => void, number>()
  const advance = async (ms: number) => {
    const until = now + ms
    while (!paused) {
      const next = [...timers].filter(([, due]) => due <= until).sort((a, b) => a[1] - b[1])[0]
      if (!next) break
      const [run, due] = next
      now = due
      timers.delete(run)
      run()
      await flush()
    }
    if (!paused) now = until
  }
  const say = vi
    .fn<(text: string, options: { signal: AbortSignal; channel?: string }) => Promise<void>>()
    .mockResolvedValue(undefined)
  const play = vi.fn().mockResolvedValue(undefined)
  const subscription = () => ({
    ready: Promise.resolve(),
    closed: new Promise<{ reason: string }>(() => {}),
    dispose() {},
  })
  const uiIds = new Set<string>()
  const register = async (definition: { id: string }) => {
    if (uiIds.has(definition.id)) throw new Error('UI IDs are unique across features and overlays')
    uiIds.add(definition.id)
    return () => {
      uiIds.delete(definition.id)
    }
  }
  const ctx = {
    config: { get: async () => null, set: async () => {} },
    capabilities: { get: () => ({ 'audio.play': { state: 'available' }, 'tts.say': { state: 'available' } }) },
    clock: {
      now: () => now,
      state: () => ({ now, generation, base: 'packet-unix', source: 'replay', paused }),
      setTimeout: (run: () => void, ms: number) => {
        timers.set(run, now + ms)
        return () => {
          timers.delete(run)
        }
      },
      sleep: async () => {},
    },
    views: {
      set: (channel: string, value: unknown) => {
        if (channel === 'raidboss-catalog') catalogs.push(structuredClone(value))
        else latest = structuredClone(value)
      },
      flush: async () => {},
      onCommand: async (_channel: string, fn: typeof commands) => {
        commands = fn
        return () => {}
      },
    },
    ui: { registerFeature: register, registerOverlay: register },
    session: {
      subscribe(fn: (value: Batch<any>) => void) {
        updateSession = fn
        queueMicrotask(() =>
          fn(batch({ sessionId: 'test', characterGeneration: 1, state: 'replay', clock: ctx.clock.state() })),
        )
        return subscription()
      },
    },
    game: {
      subscribe(topic: string, fn: (value: Batch<any>) => void) {
        callbacks[topic] = fn
        queueMicrotask(() =>
          fn(
            batch({
              meta: topic === 'party' ? { ...meta, observedAt: meta.observedAt + 100 } : meta,
              value: game[topic],
            }),
          ),
        )
        return subscription()
      },
    },
    events: {
      subscribe(_types: string[], fn: typeof event) {
        event = fn
        eventSubscriptions++
        return {
          ...subscription(),
          closed: new Promise((resolve) => {
            closeEvents = resolve
          }),
        }
      },
    },
    tts: { say },
    audio: { play },
    log: { error: () => {} },
  }
  const dispose = await activateRaidboss(
    ctx as unknown as PluginContext,
    [
      {
        path: 'one',
        set: {
          id: 'one',
          zoneId: 1,
          timeline: ['0 "Start" InCombat { inGameCombat: "1" } window 0,1', '120 "Timer"'],
          triggers: [
            { id: 'call', type: 'HeadMarker', netRegex: { id: '003E' }, infoText: 'One call' },
            { id: 'speech', type: 'HeadMarker', netRegex: { id: '003F' }, tts: 'Speech only' },
          ],
        },
      },
    ],
    {},
    'fixture',
  )
  await flush()
  expect(latest.moduleFault).toBeNull()
  expect(latest.sourceError).toBeNull()
  expect(latest.definitions).toBeUndefined()
  expect(catalogs.at(-1)).toMatchObject({
    revision: latest.catalogRevision,
    definitions: [{ triggerId: 'call' }, { triggerId: 'speech' }],
  })
  const published = catalogs.length
  const idleRevision = latest.revision
  await advance(250)
  expect(latest.revision).toBe(idleRevision)
  expect(catalogs).toHaveLength(published)
  // Before the first start there are no rules; starting sends them once, without another empty catalog first.
  expect(catalogs.map((catalog) => catalog.definitions.length)).toEqual([0, 2])
  let seq = 0
  const marker = async (id: number) => {
    event(
      batch({
        meta,
        value: {
          type: 'actorControl',
          data: { actorId: 1, category: 34, params: [id, 0, 0, 0], self: false },
          packet: { seq: ++seq, timestamp: 100000, sourceActorId: 1, targetActorId: 1 },
        },
      }),
    )
    await flush()
  }
  await marker(0x3e)
  expect(latest.alerts).toHaveLength(1)
  expect(say).toHaveBeenCalledExactlyOnceWith('One call', { signal: expect.any(AbortSignal) })
  // A later entity sample (observed after the queued events) must not reset the running engine.
  const later = meta.observedAt + 500
  callbacks.entities!(
    batch({
      meta: { ...meta, observedAt: later },
      value: {
        entities: [
          { id: 1, name: { ...field('Player'), observedAt: later }, classJob: { ...field(19), observedAt: later } },
        ],
        missingIds: [],
      },
    }),
  )
  await marker(0x3e)
  expect(latest.alerts).toHaveLength(2)
  expect(latest.sourceError).toBeNull()
  // A sample without the name (the local player is unreadable while a zone loads) is not an error.
  callbacks.player!(batch({ meta, value: { ...(game.player as object), name: { state: 'unknown' } } }))
  await flush()
  expect(latest.sourceError).toBeNull()
  // The end of a fight starts the engine again with the same rules: the catalog is not sent again.
  event(
    batch({
      meta,
      value: {
        type: 'playerCombatChanged',
        data: { inCombat: false },
        packet: { seq: ++seq, timestamp: 100000, sourceActorId: 1, targetActorId: 1 },
      },
    }),
  )
  await flush()
  expect(catalogs).toHaveLength(published)
  const settings = latest.settings
  await marker(0x3f)
  expect(say).toHaveBeenLastCalledWith('Speech only', { signal: expect.any(AbortSignal) })
  await commands({ expectedRevision: 0, settings: { ...settings, rules: { one: { speech: { level: 'alarm' } } } } })
  await marker(0x3f)
  expect(say).toHaveBeenLastCalledWith('Speech only', { signal: expect.any(AbortSignal), channel: 'alarm' })
  await expect(commands({ expectedRevision: 0, settings })).rejects.toThrow('配置已变更')
  await commands({ expectedRevision: 1, settings: { ...settings, audio: 'sound' } })
  await marker(0x3e)
  expect(play).toHaveBeenCalledTimes(1)
  await commands({ expectedRevision: 2, settings: { ...settings, audio: 'none' } })
  await marker(0x3e)
  expect(say).toHaveBeenCalledTimes(4)
  expect(play).toHaveBeenCalledTimes(1)
  // The host ends the events for a gap in its source: they are subscribed to again and the engine goes on.
  await marker(0x3f)
  const shown = latest.alerts.length
  expect(shown).toBeGreaterThan(0)
  closeEvents({ reason: 'source_incomplete' })
  await flush()
  callbacks.player!(batch({ meta, value: game.player }))
  await flush()
  expect(eventSubscriptions).toBe(2)
  expect(latest.sourceError).toBeNull()
  expect(latest.alerts).toHaveLength(shown)
  // The same holds when the host's parser starts over.
  closeEvents({ reason: 'stale_session' })
  await flush()
  expect(eventSubscriptions).toBe(3)
  expect(latest.sourceError).toBeNull()
  event(
    batch({
      meta: { ...meta, observedAt: now },
      value: {
        type: 'playerCombatChanged',
        data: { inCombat: true },
        packet: { seq: ++seq, timestamp: now, sourceActorId: 1, targetActorId: 1 },
      },
    }),
  )
  await advance(100_000)
  expect(latest.alerts).toHaveLength(0)
  expect(latest.bars).toMatchObject([{ text: 'Timer' }])
  const barRevision = latest.revision
  await advance(250)
  expect(latest.revision).toBe(barRevision + 1)
  const announce = () =>
    updateSession(batch({ sessionId: 'test', characterGeneration: 1, state: 'replay', clock: ctx.clock.state() }))
  paused = true
  announce()
  await flush()
  expect(latest.clock).toMatchObject({ now, paused: true })
  const pausedRevision = latest.revision
  await advance(1000)
  expect(latest.revision).toBe(pausedRevision)
  paused = false
  announce()
  await flush()
  expect(latest.clock).toMatchObject({ now, paused: false })
  // Expired bars stay on screen briefly before the engine removes them.
  await advance(21_000)
  expect(latest.bars).toHaveLength(0)
  const removalRevision = latest.revision
  await advance(1000)
  expect(latest.revision).toBe(removalRevision)
  generation++
  announce()
  await flush()
  expect(latest.clock.generation).toBe(generation)
  expect(latest.bars).toHaveLength(0)
  await dispose()
  expect(say.mock.calls[0]![1].signal.aborted).toBe(true)
  expect(timers.size).toBe(0)
})
