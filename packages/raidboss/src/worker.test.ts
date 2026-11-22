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
  const timers = new Set<() => void>()
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
      now: () => 100000,
      state: () => ({ now: 100000, generation: 1, base: 'packet-unix', source: 'replay', paused: false }),
      setTimeout: (run: () => void) => {
        timers.add(run)
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
  // Periodic state updates do not resend the rule catalog.
  const published = catalogs.length
  for (const tick of [...timers]) tick()
  await flush()
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
  // A gap in the source: the events are subscribed to again and the engine goes on.
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
  // Any other end is reported, as before.
  closeEvents({ reason: 'permission_denied' })
  await flush()
  callbacks.player!(batch({ meta, value: game.player }))
  await flush()
  expect(latest.sourceError).toContain('permission_denied')
  await dispose()
  expect(say.mock.calls[0]![1].signal.aborted).toBe(true)
  expect(timers.size).toBe(0)
})
