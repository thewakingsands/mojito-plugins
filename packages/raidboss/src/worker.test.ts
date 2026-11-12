import type { Batch, PluginContext, Sample, SourceMeta, Value } from '@ffcafe/mojito-plugin-sdk'
import { expect, it } from 'vitest'
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
  const timers = new Set<() => void>()
  const audio: AbortSignal[] = []
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
    capabilities: { get: () => ({ 'audio.play': { state: 'available' } }) },
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
        return {
          ...subscription(),
          closed: new Promise((resolve) => {
            closeEvents = resolve
          }),
        }
      },
    },
    audio: {
      say: async (_text: string, options: { signal: AbortSignal }) => {
        audio.push(options.signal)
      },
      play: async () => {},
    },
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
          triggers: [{ id: 'call', type: 'HeadMarker', netRegex: { id: '003E' }, infoText: 'One call' }],
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
  expect(catalogs.at(-1)).toMatchObject({ revision: latest.catalogRevision, definitions: [{ triggerId: 'call' }] })
  // Periodic state updates do not resend the rule catalog.
  const published = catalogs.length
  for (const tick of [...timers]) tick()
  await flush()
  expect(catalogs).toHaveLength(published)
  event(
    batch({
      meta,
      value: {
        type: 'actorControl',
        data: { actorId: 1, category: 34, params: [0x3e, 0, 0, 0], self: false },
        packet: { seq: 1, timestamp: 100000, sourceActorId: 1, targetActorId: 1 },
      },
    }),
  )
  await flush()
  expect(latest.alerts).toHaveLength(1)
  expect(audio).toHaveLength(1)
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
  event(
    batch({
      meta,
      value: {
        type: 'actorControl',
        data: { actorId: 1, category: 34, params: [0x3e, 0, 0, 0], self: false },
        packet: { seq: 2, timestamp: 100000, sourceActorId: 1, targetActorId: 1 },
      },
    }),
  )
  await flush()
  expect(latest.alerts).toHaveLength(2)
  expect(latest.sourceError).toBeNull()
  const settings = latest.settings
  await commands({ expectedRevision: 0, settings })
  await expect(commands({ expectedRevision: 0, settings })).rejects.toThrow('配置已变更')
  closeEvents({ reason: 'source_incomplete' })
  await flush()
  callbacks.player!(batch({ meta, value: game.player }))
  await flush()
  expect(latest.sourceError).toContain('source_incomplete')
  await dispose()
  expect(audio[0]!.aborted).toBe(true)
  expect(timers.size).toBe(0)
})
