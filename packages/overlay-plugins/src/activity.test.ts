import type { Field, PluginContext } from '@ffcafe/mojito-plugin-sdk'
import { afterEach, expect, it, vi } from 'vitest'
import { observeActivity } from './activity.js'
import { observeGlassActivity } from './glass-activity.js'

const clock = { source: 'replay', base: 'packet-unix', generation: 0 }
const meta = {
  sessionId: 'fixture',
  characterGeneration: 1,
  source: clock.source,
  timeBase: clock.base,
  clockGeneration: clock.generation,
  observedAt: 1000,
}
const session = {
  sessionId: meta.sessionId,
  state: 'replay',
  characterGeneration: 1,
  character: { actorId: 16 },
  capabilities: {},
  clock,
}
const ok = <T>(value: T): Field<T> => ({
  state: 'ok',
  value,
  observedAt: 1000,
  timeBase: 'packet-unix',
  from: 'memory',
})
const action = (sourceActorId: number, sequence: number, actionId = 75) => ({
  type: 'actionEffect',
  data: { sourceActorId, actionType: 1, sequence, actionId },
})
afterEach(() => vi.useRealTimers())

function batch(...items: unknown[]) {
  return { complete: true, items }
}
function samples(...values: unknown[]) {
  return batch(...values.map((value) => ({ value, meta })))
}
function fixture(observe = observeActivity) {
  let now = 1000
  vi.useFakeTimers({ now: 101000 })
  const subscriptions = new Map<
    string,
    {
      receive: (value: ReturnType<typeof batch>) => void
      dispose: ReturnType<typeof vi.fn>
      close: (value: { reason: string }) => void
    }
  >()
  const setTimeout = vi.fn()
  const subscribe = (name: string, receive: (value: ReturnType<typeof batch>) => void) => {
    const dispose = vi.fn()
    let close!: (value: { reason: string }) => void
    const closed = new Promise<{ reason: string }>((resolve) => {
      close = resolve
    })
    subscriptions.set(name, { receive, dispose, close })
    return { dispose, ready: Promise.resolve(), closed }
  }
  const getCombatants = vi.fn()
  const context = {
    signal: new AbortController().signal,
    clock: {
      state: () => clock,
      now: () => now,
      setTimeout,
    },
    session: { subscribe: (receive: Parameters<typeof subscribe>[1]) => subscribe('session', receive) },
    events: { subscribe: (_: string[], receive: Parameters<typeof subscribe>[1]) => subscribe('events', receive) },
    game: { subscribe, getCombatants },
  } as unknown as PluginContext
  const publish = vi.fn()
  const stop = observe(context, publish)
  const send = (name: string, data: ReturnType<typeof batch>) => subscriptions.get(name)?.receive(data)
  send('session', batch(session))
  return {
    advance: (next: number) => {
      vi.advanceTimersByTime(next - now)
      now = next
    },
    send,
    stop,
    publish,
    subscriptions,
    getCombatants,
    setTimeout,
    last: () => publish.mock.lastCall?.[0],
  }
}
it('retains separate actions from coalesced batches, deduplicates AOE, and prunes by age and size', () => {
  const f = fixture()
  f.send(
    'party',
    samples({
      isInParty: ok(true),
      members: ok([{ slot: 1, id: 17, name: 'Second', ownParty: true }]),
    }),
  )
  f.send('events', samples(action(16, 0), action(16, 0), action(17, 0, 76)))
  f.send('events', samples(action(16, 1, 77)))
  expect(f.last().publishedAt).toBe(101000)
  expect(f.last().actions).toEqual([
    { key: '16:0', actorId: 16, actionId: 75, ageMs: 0 },
    { key: '17:0', actorId: 17, actionId: 76, ageMs: 0 },
    { key: '16:1', actorId: 16, actionId: 77, ageMs: 0 },
  ])
  const publications = f.publish.mock.calls.length
  f.advance(1100)
  f.send('events', samples(action(16, 0)))
  expect(f.publish).toHaveBeenCalledTimes(publications)
  f.send('entities', samples({ entities: [{ id: 16, hpCur: ok(5) }], missingIds: [] }))
  expect(f.last().publishedAt).toBe(101100)
  expect(f.last().actions.map((action: { ageMs: number }) => action.ageMs)).toEqual([100, 100, 100])
  f.send('events', samples(...Array.from({ length: 130 }, (_, index) => action(16, index + 2))))
  expect(f.last().actions).toHaveLength(128)
  expect(f.last().actions[0].key).toBe('16:4')
  f.advance(11000)
  expect(f.last().actions).toHaveLength(128)
  f.send('entities', samples({ entities: [{ id: 16, hpCur: ok(4) }], missingIds: [] }))
  expect(f.last().actions).toEqual([])
})
it('updates only changed slots, preserves zero resources, and treats unknown party as unavailable', () => {
  const f = fixture()
  const status = (statusId: number, durationMs: number | null) => ({
    statusId,
    sourceActorId: 16,
    param: 0,
    durationMs,
    observedAt: 1000,
    timeBase: 'packet-unix',
  })
  f.send(
    'party',
    samples({
      isInParty: ok(true),
      members: ok([
        { slot: 2, id: 18, name: 'Other', ownParty: false },
        { slot: 1, id: 17, name: 'Member', ownParty: true },
      ]),
    }),
  )
  f.send(
    'entities',
    samples({
      entities: [
        { id: 16, hpCur: ok(0), mpMax: ok(10000) },
        { id: 17, name: ok('Member') },
      ],
      missingIds: [],
    }),
  )
  f.send(
    'events',
    samples({
      type: 'statusesReplaced',
      data: {
        actorId: 16,
        statuses: [
          { ...status(3, 4000), slot: 4 },
          { ...status(5, null), slot: 5 },
        ],
      },
    }),
  )
  const newStatus = status(7, 2000)
  f.send(
    'events',
    samples({
      type: 'statusSlotsChanged',
      data: {
        actorId: 16,
        slots: [{ slot: 4, status: newStatus }],
        changes: [{ kind: 'gained', slot: 4, status: newStatus }],
      },
    }),
  )
  f.advance(1200)
  f.send(
    'entities',
    samples({ entities: [{ id: 16, hpCur: ok(0), mpMax: ok(10000), level: ok(100) }], missingIds: [] }),
  )
  expect(f.last()).toMatchObject({
    actors: [
      { id: 16, hpCur: 0, mpMax: 10000 },
      { id: 17, name: 'Member' },
    ],
    statuses: [
      {
        actorId: 16,
        items: [
          { slot: 4, statusId: 7, remainingMs: 1800 },
          { slot: 5, statusId: 5, remainingMs: null },
        ],
      },
      { actorId: 17, items: null },
    ],
  })
  expect(f.last().actors[0]).not.toHaveProperty('hpMax')
  f.send(
    'events',
    samples({
      type: 'statusSlotsChanged',
      data: { actorId: 16, slots: [{ slot: 4, status: null }], changes: [{ kind: 'lost', slot: 4 }] },
    }),
  )
  expect(f.last().statuses[0].items).toEqual([{ slot: 5, statusId: 5, sourceActorId: 16, param: 0, remainingMs: null }])
  f.send('party', samples({}))
  expect(f.last()).toMatchObject({ party: null, actors: [{ id: 16 }, { id: 17 }] })
  f.send('party', samples({ isInParty: ok(false) }))
  expect(f.last()).toMatchObject({ party: { isInParty: false, members: [] }, actors: [{ id: 16 }] })
})
it('keeps the retained frame during identical observations and prunes expired statuses on the next change', () => {
  const f = fixture()
  const entity = { id: 16, hpCur: ok(100) }
  const entities = (value = entity) => samples({ entities: [value], missingIds: [] })
  f.send('entities', entities())
  f.send(
    'events',
    samples({
      type: 'statusesReplaced',
      data: {
        actorId: 16,
        statuses: [{ statusId: 1177, sourceActorId: 16, param: 3, durationMs: 1500, observedAt: 1000, slot: 0 }],
      },
    }),
  )
  f.send('events', samples(action(16, 0)))
  vi.advanceTimersByTime(500)
  f.send('entities', entities({ ...entity, hpCur: ok(99) }))
  expect(f.last()).toMatchObject({
    publishedAt: 101500,
    statuses: [{ actorId: 16, items: [{ remainingMs: 1000 }] }],
  })
  const retained = f.last()
  const publications = f.publish.mock.calls.length
  f.advance(3000)
  f.send('entities', entities({ ...entity, hpCur: ok(99) }))
  f.send('events', samples(action(16, 0)))
  expect(f.setTimeout).not.toHaveBeenCalled()
  expect(f.publish).toHaveBeenCalledTimes(publications)
  expect(f.last()).toBe(retained)
  f.send('entities', entities({ ...entity, hpCur: ok(98) }))
  expect(f.last()).toMatchObject({ publishedAt: 103500, statuses: [{ actorId: 16, items: [] }] })
})
it('reads on after a gap, and invalidates the old sample callbacks on a character change and stop', async () => {
  const f = fixture()
  f.send('events', samples(action(16, 1)))
  // A gap in the source ends the events: what was read stays, and they are subscribed to again.
  const ended = f.subscriptions.get('events')
  ended?.close({ reason: 'source_incomplete' })
  await vi.advanceTimersByTimeAsync(0)
  expect(ended?.dispose).toHaveBeenCalledOnce()
  expect(f.subscriptions.get('events')).not.toBe(ended)
  expect(f.last()).toMatchObject({ epoch: 1, actions: [{ key: '16:1' }] })
  f.send('events', samples(action(16, 2)))
  expect(f.last()).toMatchObject({ epoch: 1, actions: [{ key: '16:1' }, { key: '16:2' }] })
  const old = f.subscriptions.get('events')
  f.send('session', batch({ ...session, characterGeneration: 2 }))
  expect(old?.dispose).toHaveBeenCalledOnce()
  old?.receive(samples(action(16, 3)))
  expect(f.last()).toMatchObject({ epoch: 2, actions: [] })
  // The party is read by its own subscription, which is not opened again: its end clears the activity.
  f.subscriptions.get('party')?.close({ reason: 'stale_session' })
  await vi.advanceTimersByTimeAsync(0)
  expect(f.last()).toMatchObject({ epoch: 3, actions: [], statuses: [] })
  void f.stop()
  expect(f.subscriptions.get('session')?.dispose).toHaveBeenCalledOnce()
})

it('looks up Glass casters in one batch, including non-party actors, and retains publishedAt for duplicates', async () => {
  const f = fixture(observeGlassActivity)
  f.getCombatants.mockResolvedValue({
    meta,
    value: {
      entities: [
        { id: 16, name: ok('Self') },
        { id: 17, name: ok('Other') },
      ],
    },
  })
  f.advance(3000)
  f.send('events', samples(action(16, 5, 24298), action(16, 5, 24298), action(17, 5, 24305)))
  await Promise.resolve()
  expect(f.getCombatants).toHaveBeenCalledExactlyOnceWith(
    { ids: [16, 17], fields: ['name'] },
    { signal: expect.any(AbortSignal) },
  )
  expect(f.last()).toMatchObject({
    epoch: 1,
    publishedAt: 103000,
    actions: [
      { key: '16:5', actionId: 24298, casterName: 'Self', ageMs: 2000 },
      { key: '17:5', actionId: 24305, casterName: 'Other', ageMs: 2000 },
    ],
  })
  f.advance(3100)
  f.send('events', samples(action(16, 5, 24298)))
  expect(f.last().publishedAt).toBe(103000)
  f.stop()
})

it('does not publish a late Glass name lookup from a previous character generation', async () => {
  const f = fixture(observeGlassActivity)
  let complete!: (value: unknown) => void
  f.getCombatants.mockReturnValue(
    new Promise((resolve) => {
      complete = resolve
    }),
  )
  f.send('events', samples(action(16, 7, 24298)))
  const signal = f.getCombatants.mock.calls[0][1].signal
  f.send('session', batch({ ...session, characterGeneration: 2, character: { actorId: 17 } }))
  complete({ meta, value: { entities: [{ id: 16, name: ok('Old name') }] } })
  await Promise.resolve()
  expect(signal.aborted).toBe(true)
  expect(f.last()).toMatchObject({ epoch: 2, actions: [] })
  f.stop()
})
