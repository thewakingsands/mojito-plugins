import { periodicDefs } from '@ffcafe/mojito-combat-model/defs'
import type { Batch, GameTopics, PluginContext, Sample, SessionSnapshot, Value } from '@ffcafe/mojito-plugin-sdk'
import { expect, it, vi } from 'vitest'
import type { GameEvent } from './combat-events.js'
import { activate, PUBLISH_MS } from './entry.js'
import { effect, meta, sample } from './fixtures.js'
import type { StatisticsState } from './view-model.js'

const batch = <T>(items: T[]): Batch<T> => ({
  subscriptionId: 'test',
  batchId: 1,
  firstSeq: 1,
  lastSeq: items.length,
  initial: false,
  complete: true,
  items,
})
const subscription = () => ({
  ready: Promise.resolve(),
  closed: new Promise<{ reason: string }>(() => {}),
  dispose() {},
})
async function harness() {
  let receiveSession!: (batch: Batch<SessionSnapshot>) => Promise<void>
  let receiveEvents!: (batch: Batch<ReturnType<typeof sample<GameEvent>>>) => Promise<void>
  let receiveZone!: (batch: Batch<Sample<GameTopics['zone']>>) => Promise<void>
  let receivePlayer!: (batch: Batch<Sample<GameTopics['player']>>) => Promise<void>
  let receiveParty!: (batch: Batch<Sample<GameTopics['party']>>) => Promise<void>
  let types: unknown
  let now = 1000,
    paused = false
  let blockPublish: (() => Promise<void>) | null = null
  const published: string[] = []
  const files = new Map<string, Uint8Array>(),
    snapshots = new Map<string, Value>(),
    commands = new Map<string, (input: Value) => Promise<Value>>()
  const field = <T>(value: T) => ({ state: 'ok', value, observedAt: now, from: 'packet', timeBase: 'packet-unix' })
  const ctx = {
    identity: { activationId: 'test' },
    limits: { values: { 'game.entities': 512 } },
    capabilities: { get: () => ({ 'data.read': { state: 'available' } }) },
    log: { debug() {}, error() {}, info() {}, warn() {} },
    config: { get: async () => null, set: async () => {} },
    storage: {
      read: async (path: string) => {
        const file = files.get(path)
        if (!file) throw { code: 'not_found' }
        return file
      },
      write: async (path: string, bytes: Uint8Array) => {
        files.set(path, bytes.slice())
      },
      delete: async (path: string) => {
        files.delete(path)
      },
      list: async () => [...files.keys()],
    },
    session: {
      subscribe: (listener: typeof receiveSession) => {
        receiveSession = listener
        return subscription()
      },
    },
    events: {
      subscribe: (selection: string[], listener: typeof receiveEvents) => {
        // The combat log's cast and status subscription is separate from the ordered statistics one.
        if (selection.includes('actionEffect')) {
          types = selection
          receiveEvents = listener
        }
        return subscription()
      },
    },
    data: { name: async (kind: string) => (kind === 'action' ? '技能' : '海雾村') },
    game: {
      getPlayer: async () => ({
        meta: meta(now),
        value: {
          actorId: field(1),
          name: field('Synthetic'),
          inCombat: { state: 'unavailable', reason: 'not provided' },
        },
      }),
      subscribe: (topic: string, listener: typeof receiveZone) => {
        if (topic === 'zone') receiveZone = listener
        if (topic === 'player') receivePlayer = listener as unknown as typeof receivePlayer
        if (topic === 'party') receiveParty = listener as unknown as typeof receiveParty
        return subscription()
      },
      getCombatants: async () => ({
        meta: meta(now),
        value: {
          missingIds: [],
          entities: [
            { id: 1, objectKind: field(1), name: field('Synthetic'), ownerId: field(null), bNpcBase: field(0) },
            { id: 9, objectKind: field(2), name: field('Enemy'), ownerId: field(null), bNpcBase: field(1) },
          ],
        },
      }),
    },
    clock: { now: () => now, state: () => ({ paused }), setTimeout: () => () => {} },
    services: {
      provide: async () => () => {},
      publish: async (_name: string, _event: string, envelope: { state: Value }) => {
        snapshots.set('combat', envelope.state)
        published.push('combat')
      },
    },
    views: {
      set: (channel: string, value: Value) => {
        snapshots.set(channel, value)
        published.push(channel)
      },
      flush: async () => {
        if (blockPublish) await blockPublish()
      },
      onCommand: async (channel: string, handler: (input: Value) => Promise<Value>) => {
        commands.set(channel, handler)
        return () => {}
      },
    },
    ui: { registerFeature: async () => () => {} },
  } as unknown as PluginContext
  const dispose = await activate(ctx)
  await receiveSession(
    batch([
      {
        state: 'replay',
        opcodeVersion: periodicDefs.version,
        sessionId: 'source',
        characterGeneration: 1,
        clock: { generation: 1 },
        character: { actorId: 1 },
        dataLanguage: 'cn',
      } as SessionSnapshot,
    ]),
  )
  // Playing solo: the statistics wait for the party before counting.
  await receiveParty(
    batch([
      { meta: meta(now), value: { isInParty: field(false), members: field([]) } } as unknown as Sample<
        GameTopics['party']
      >,
    ]),
  )
  await receiveZone(
    batch([
      { meta: meta(now), value: { territoryType: field(339), mapId: field(1) } } as unknown as Sample<
        GameTopics['zone']
      >,
    ]),
  )
  return {
    files,
    snapshots,
    commands,
    published,
    types,
    dispose,
    /** Delivers events and runs the publication the plugin delays after them */
    events: async (items: Sample<GameEvent>[]) => {
      await receiveEvents(batch(items))
      await vi.advanceTimersByTimeAsync(PUBLISH_MS)
    },
    receiveSession,
    setNow: (value: number) => {
      now = value
    },
    setPaused: (value: boolean) => {
      paused = value
    },
    block: (value: (() => Promise<void>) | null) => {
      blockPublish = value
    },
    player: async (inCombat: boolean) => {
      await receivePlayer(
        batch([
          {
            meta: meta(now),
            value: {
              actorId: field(1),
              name: field('Synthetic'),
              inCombat: field(inCombat),
            },
          } as unknown as Sample<GameTopics['player']>,
        ]),
      )
      await vi.advanceTimersByTimeAsync(PUBLISH_MS)
    },
  }
}

it('refreshes idle display once a second without delaying new facts', async () => {
  vi.useFakeTimers()
  const app = await harness()
  try {
    await app.player(true)
    await app.events([sample(effect(1, 100), 1000)])
    const count = app.published.length
    app.setNow(1999)
    await vi.advanceTimersByTimeAsync(999)
    expect(app.published).toHaveLength(count)
    app.setNow(2000)
    await vi.advanceTimersByTimeAsync(1)
    expect(app.published).toHaveLength(count + 2)
    app.setNow(2100)
    await app.events([sample(effect(2, 200), 2100)])
    expect(app.snapshots.get('combat')).toMatchObject({ combatData: { Encounter: { damage: '300' } } })
    expect(app.published.length).toBeGreaterThan(count + 2)
  } finally {
    await app.dispose()
    vi.useRealTimers()
  }
})

it('ticks from the source clock, holds pause, settles on false and keeps historical bytes factual', async () => {
  vi.useFakeTimers()
  const app = await harness()
  try {
    await app.player(true)
    await app.events([sample(effect(1, 100), 1000)])
    const before = [...app.files]
    app.setNow(3000)
    await vi.advanceTimersByTimeAsync(1000)
    expect(app.snapshots.get('combat')).toMatchObject({ combatData: { Encounter: { DURATION: '2', encdps: '50.00' } } })
    expect([...app.files]).toEqual(before)
    app.setPaused(true)
    const count = app.published.length
    await vi.advanceTimersByTimeAsync(2000)
    expect(app.published).toHaveLength(count)
    expect(app.snapshots.get('statistics')).toMatchObject({ current: { durationMs: 2000 } })
    app.setPaused(false)
    app.setNow(5000)
    await vi.advanceTimersByTimeAsync(1000)
    expect(app.snapshots.get('combat')).toMatchObject({ combatData: { Encounter: { DURATION: '4', encdps: '25.00' } } })
    await app.player(false)
    expect(app.snapshots.get('combat')).toMatchObject({ combatData: { Encounter: { DURATION: '0' } } })
    // Only the combat log's ten-second flush remains while the harness is in a zone.
    expect(vi.getTimerCount()).toBe(1)
    const current = (app.snapshots.get('statistics') as unknown as { current: { id: string } }).current
    await app.commands.get('statistics')!({ kind: 'end', id: current.id })
    // The ended fight stays selected and shows its facts, not the projected display time.
    const saved = (app.snapshots.get('statistics') as unknown as StatisticsState).selected
    expect(saved).toMatchObject({ id: current.id, ended: true })
    expect(JSON.stringify(saved)).not.toContain('lastFactSourceAt')
    expect(JSON.stringify(saved)).not.toContain('"durationMs":4000')
    expect(JSON.stringify(saved)).toContain('"durationMs":0')
  } finally {
    await app.dispose()
    vi.useRealTimers()
  }
})

it('coalesces slow display refreshes and releases all refresh work on disposal', async () => {
  vi.useFakeTimers()
  const app = await harness()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  try {
    await app.events([sample(effect(1), 1000)])
    // A command waiting for its views to reach the host holds the refreshes behind it.
    app.block(() => gate)
    const command = app.commands.get('statistics')!({ kind: 'current' })
    await vi.advanceTimersByTimeAsync(0)
    const before = app.published.length
    app.setNow(2000)
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(3000)
    expect(app.published).toHaveLength(before)
    release()
    app.block(null)
    await command
    await vi.advanceTimersByTimeAsync(0)
    // A single statistics + compatibility publication, not one queued refresh per interval.
    expect(app.published).toHaveLength(before + 2)
    const done = app.dispose()
    await done
    const stopped = app.published.length
    app.setNow(9000)
    await vi.advanceTimersByTimeAsync(2000)
    expect(app.published).toHaveLength(stopped)
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    release()
    await app.dispose()
    vi.useRealTimers()
  }
})

it('clears the active projection on source invalidation and publishes no later ticks', async () => {
  vi.useFakeTimers()
  const app = await harness()
  try {
    await app.events([sample(effect(1), 1000)])
    app.setNow(3000)
    await vi.advanceTimersByTimeAsync(1000)
    await app.receiveSession(
      batch([
        {
          state: 'idle',
          sessionId: null,
          characterGeneration: 0,
          character: null,
          clock: { generation: 2 },
        } as SessionSnapshot,
      ]),
    )
    expect(app.snapshots.get('statistics')).toMatchObject({ current: { ended: true, durationMs: 0 } })
    const count = app.published.length
    await vi.advanceTimersByTimeAsync(1000)
    expect(app.published).toHaveLength(count)
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    await app.dispose()
    vi.useRealTimers()
  }
})

it('publishes qualified settlement and keeps it for the ended fight after incoming damage', async () => {
  vi.useFakeTimers()
  const app = await harness()
  try {
    await app.player(true)
    await app.events([sample(effect(1, 10, 9, 1), 1000)])
    app.setNow(2000)
    await vi.advanceTimersByTimeAsync(1000)
    expect(app.snapshots.get('statistics')).toMatchObject({ current: { durationMs: 0 } })
    await app.events([sample(effect(2, 100), 2000), sample(effect(3, 200), 3000)])
    app.setNow(4000)
    await app.events([sample(effect(4, 20, 9, 1), 4000)])
    await app.events([
      sample({ type: 'playerCombatChanged', packet: effect(5).packet, data: { actorId: 1, inCombat: false } }, 4500),
    ])
    expect(app.snapshots.get('combat')).toMatchObject({
      combatData: {
        Encounter: { DURATION: '1', damage: '300', encdps: '300.00' },
        Combatant: { YOU: { DURATION: '1', dps: '300.00', encdps: '300.00' } },
      },
    })
    const selected = () => (app.snapshots.get('statistics') as unknown as StatisticsState).selected!
    const saved = selected()
    expect(saved).toMatchObject({ ended: true, durationMs: 1000, startAt: 2000, endAt: 3000 })
    expect(saved.rows[0]).toMatchObject({ hasSettlementTime: true, totals: { damage: 300, taken: 30 } })
    app.setNow(9000)
    await vi.advanceTimersByTimeAsync(2000)
    expect(selected()).toEqual(saved)
  } finally {
    await app.dispose()
    vi.useRealTimers()
  }
})
