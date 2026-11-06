import type {
  Batch,
  BatchListener,
  GameEvent,
  PluginContext,
  Sample,
  SessionSnapshot,
  Value,
  ViewIdentity,
} from '@ffcafe/mojito-plugin-sdk'
import { afterEach, expect, it, vi } from 'vitest'
import { activate } from './entry.js'
import type { DisplayState } from './state.js'

const batch = <T>(items: T[], complete = true): Batch<T> => ({
  subscriptionId: 'test',
  batchId: 1,
  firstSeq: 1,
  lastSeq: items.length,
  initial: false,
  complete,
  items,
})
async function harness() {
  vi.useFakeTimers()
  let receiveSession!: BatchListener<SessionSnapshot>, receiveEvents!: BatchListener<Sample<GameEvent>>
  let handler!: (input: Value, view: ViewIdentity) => Value | Promise<Value>
  let state!: DisplayState
  let snapshot = {
    state: 'replay',
    sessionId: 'synthetic',
    characterGeneration: 1,
    character: { actorId: 1 },
    dataLanguage: 'en',
    clock: { now: 1000, generation: 1, source: 'replay', base: 'packet-unix', paused: false },
  } as SessionSnapshot
  const subscriptions: { dispose: ReturnType<typeof vi.fn>; close: (value: { reason: string }) => void }[] = []
  const subscription = () => {
    let close!: (value: { reason: string }) => void
    const sub = {
      ready: Promise.resolve(),
      closed: new Promise<{ reason: string }>((resolve) => {
        close = resolve
      }),
      dispose: vi.fn(),
    }
    subscriptions.push({ dispose: sub.dispose, close })
    return sub
  }
  const rows = vi.fn(async (_sheet: string, ids: number[]) =>
    ids
      .filter((id) => id !== 999)
      .map((rowId) => ({
        rowId,
        subrows: [
          {
            subrowId: null,
            cells: Array.from({ length: 42 }, (_, i) => ({
              type: 'number',
              value: i === 2 ? 10 : i === 41 && rowId === 20 ? 58 : 0,
            })),
          },
        ],
      })),
  )
  const icon = vi.fn(async () => ({ data: new Uint8Array([1]), mime: 'image/png', width: 1, height: 1 }))
  const config = { get: vi.fn(async () => null), set: vi.fn(async () => {}) }
  const views = {
    set: vi.fn((_channel: string, value: DisplayState) => {
      state = value
    }),
    flush: vi.fn(async () => {}),
    onCommand: async (_channel: string, callback: typeof handler) => {
      handler = callback
      return () => {}
    },
  }
  const ctx = {
    session: {
      subscribe: (listener: typeof receiveSession) => {
        receiveSession = listener
        return subscription()
      },
    },
    events: {
      subscribe: vi.fn((_types: string[], listener: typeof receiveEvents) => {
        receiveEvents = listener
        return subscription()
      }),
    },
    clock: { state: () => snapshot.clock, now: () => snapshot.clock.now },
    data: {
      version: vi.fn(async () => 'synthetic-v1'),
      rows,
      name: async (_kind: string, id: number) => String(id),
      icon,
    },
    config,
    views,
    ui: { registerOverlay: async () => () => {}, registerFeature: async () => () => {} },
    log: { debug() {}, warn() {} },
  } as unknown as PluginContext
  const dispose = await activate(ctx)
  await receiveSession(batch([snapshot]))
  await vi.advanceTimersByTimeAsync(0)
  return {
    ctx,
    config,
    views,
    rows,
    icon,
    subscriptions,
    dispose,
    state: () => state,
    session: async (patch: Partial<SessionSnapshot>) => {
      snapshot = { ...snapshot, ...patch }
      await receiveSession(batch([snapshot]))
      await vi.advanceTimersByTimeAsync(0)
    },
    event: (sequence: number, patch = {}, meta = {}): Sample<GameEvent> => ({
      meta: {
        sessionId: 'synthetic',
        characterGeneration: 1,
        source: 'replay',
        observedAt: snapshot.clock.now!,
        timeBase: 'packet-unix',
        clockGeneration: snapshot.clock.generation,
        sampleStartedAt: null,
        sampleEndedAt: null,
        ...meta,
      },
      value: {
        type: 'actionEffect',
        data: { sourceActorId: 1, sequence, actionId: 20, actionType: 1, targets: [], ...patch },
      } as unknown as GameEvent,
    }),
    send: async (items: Sample<GameEvent>[], complete = true) => {
      await receiveEvents(batch(items, complete))
      await vi.advanceTimersByTimeAsync(0)
    },
    command: (value: Value) => handler(value, { placement: 'settings' } as ViewIdentity),
  }
}
afterEach(() => {
  vi.useRealTimers()
})
it('counts only own results, preserves a whole batch, and deduplicates source:sequence including zero', async () => {
  const h = await harness()
  await h.send([
    h.event(0),
    h.event(0),
    h.event(1, { targets: [{}, {}] }),
    h.event(2),
    h.event(3, { sourceActorId: 2 }),
    h.event(4, { sourceActorId: 3 }),
    h.event(5, { actionId: 7 }),
    h.event(6, { actionType: 2 }),
  ])
  expect(h.state().actions.map((a) => a.key)).toEqual(['1:0', '1:1', '1:2'])
  expect(h.state().actions.every((a) => a.gcd)).toBe(true)
  await h.session({ clock: { ...h.state().clock, now: 11000 } })
  await vi.advanceTimersByTimeAsync(1000)
  expect(h.state().actions).toEqual([])
  await h.send([h.event(0)])
  expect(h.state().actions).toHaveLength(1)
  await h.dispose()
})
it('clears identity and clock boundaries, ignores stale metadata and late resource responses', async () => {
  const h = await harness()
  let release!: (value: Awaited<ReturnType<typeof h.rows>>) => void
  h.rows.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve
      }),
  )
  await h.send([h.event(1)])
  await h.session({ characterGeneration: 2, character: { actorId: 5, contentId: null } })
  release([{ rowId: 20, subrows: [] }])
  await h.send([h.event(2)])
  expect(h.state().actions).toEqual([])
  await h.send([h.event(2, { sourceActorId: 5 }, { characterGeneration: 2 })])
  expect(h.state().actions).toHaveLength(1)
  await h.session({ clock: { ...h.state().clock, now: 0, generation: 2 } })
  expect(h.state().actions).toEqual([])
  await h.send([h.event(3, { sourceActorId: 5 }, { characterGeneration: 2, clockGeneration: 1 })])
  expect(h.state().actions).toEqual([])
  await h.session({ sessionId: 'next' })
  expect(h.state().actions).toEqual([])
  await h.dispose()
})
it('coalesces icons, accepts off-history IDs, and preserves normal placeholders', async () => {
  const h = await harness()
  const [a, b] = await Promise.all([h.command({ type: 'icon', id: 20 }), h.command({ type: 'icon', id: 21 })])
  expect(a).toEqual(b)
  expect(h.icon).toHaveBeenCalledTimes(1)
  await h.send([h.event(1, { actionId: 999 })])
  expect(h.state().actions[0]).toMatchObject({ id: 999, name: '999', gcd: false, icon: null })
  await expect(h.command({ type: 'icon', id: 0 })).rejects.toThrow('Invalid command')
  await h.dispose()
})
it('retries incomplete inputs, publishes calibration only once a second, and cleans up', async () => {
  const h = await harness()
  h.views.set.mockClear()
  await vi.advanceTimersByTimeAsync(999)
  expect(h.views.set).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(h.views.set).toHaveBeenCalledTimes(1)
  await h.send([h.event(1)], false)
  expect(h.state().reason).toContain('不完整')
  expect(h.state().actions).toEqual([])
  await vi.advanceTimersByTimeAsync(9000)
  expect(h.ctx.events.subscribe).toHaveBeenCalledTimes(2)
  await h.send([h.event(2)])
  expect(h.state().reason).toBeNull()
  expect(h.state().actions).toHaveLength(1)
  await h.session({ clock: { ...h.state().clock, paused: true } })
  expect(h.views.flush).toHaveBeenCalled()
  await h.dispose()
  expect(h.subscriptions.every((sub) => sub.dispose.mock.calls.length > 0)).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
})
it('keeps saved settings on write failure', async () => {
  const h = await harness()
  h.config.set.mockRejectedValueOnce(new Error('disk full'))
  await expect(h.command({ type: 'settings', value: { seconds: 5, scale: 150, newest: 'left' } })).rejects.toThrow(
    'disk full',
  )
  expect(h.state().settings).toEqual({ seconds: 10, scale: 100, newest: 'right' })
  await h.command({ type: 'settings', value: { seconds: 5, scale: 150, newest: 'left' } })
  expect(h.state().settings.seconds).toBe(5)
  await h.dispose()
})

it('reloads resources when the data version changes and retries a failed icon', async () => {
  const h = await harness()
  h.icon.mockRejectedValueOnce(new Error('unavailable'))
  await expect(h.command({ type: 'icon', id: 20 })).rejects.toThrow('unavailable')
  expect(await h.command({ type: 'icon', id: 20 })).not.toBeNull()
  await h.send([h.event(1)])
  const resource = h.state().resources
  vi.mocked(h.ctx.data.version).mockResolvedValue('synthetic-v2')
  await vi.advanceTimersByTimeAsync(10000)
  expect(h.state().resources).not.toBe(resource)
  expect(h.rows.mock.calls.filter((call) => call[1][0] === 20)).toHaveLength(2)
  await h.dispose()
})
