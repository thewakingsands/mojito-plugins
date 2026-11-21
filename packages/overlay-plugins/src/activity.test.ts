import type { Field, PluginContext } from '@ffcafe/mojito-plugin-sdk'
import { expect, it, vi } from 'vitest'
import { observeActivity } from './activity.js'

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
function batch(...items: unknown[]) {
  return { complete: true, items }
}
function samples(...values: unknown[]) {
  return batch(...values.map((value) => ({ value, meta })))
}
function fixture() {
  let now = 1000
  const subscriptions = new Map<
    string,
    { receive: (value: ReturnType<typeof batch>) => void; dispose: ReturnType<typeof vi.fn> }
  >()
  const timers = new Set<() => void>()
  const subscribe = (name: string, receive: (value: ReturnType<typeof batch>) => void) => {
    const dispose = vi.fn()
    subscriptions.set(name, { receive, dispose })
    return { dispose, ready: Promise.resolve(), closed: new Promise(() => {}) }
  }
  const context = {
    signal: new AbortController().signal,
    clock: {
      state: () => clock,
      now: () => now,
      setTimeout: (callback: () => void) => {
        timers.add(callback)
        return () => timers.delete(callback)
      },
    },
    session: { subscribe: (receive: Parameters<typeof subscribe>[1]) => subscribe('session', receive) },
    events: { subscribe: (_: string[], receive: Parameters<typeof subscribe>[1]) => subscribe('events', receive) },
    game: { subscribe },
  } as unknown as PluginContext
  const publish = vi.fn()
  const stop = observeActivity(context, publish)
  const send = (name: string, data: ReturnType<typeof batch>) => subscriptions.get(name)?.receive(data)
  send('session', batch(session))
  return {
    advance: (next: number) => {
      now = next
      const due = [...timers]
      timers.clear()
      for (const run of due) run()
    },
    send,
    stop,
    publish,
    subscriptions,
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
  expect(f.last().actions).toEqual([
    { key: '16:0', actorId: 16, actionId: 75, ageMs: 0 },
    { key: '17:0', actorId: 17, actionId: 76, ageMs: 0 },
    { key: '16:1', actorId: 16, actionId: 77, ageMs: 0 },
  ])
  f.advance(1100)
  expect(f.last().actions.map((action: { ageMs: number }) => action.ageMs)).toEqual([100, 100, 100])
  f.send('events', samples(...Array.from({ length: 130 }, (_, index) => action(16, index + 2))))
  expect(f.last().actions).toHaveLength(128)
  expect(f.last().actions[0].key).toBe('16:4')
  f.advance(11000)
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
it('invalidates the old sample callbacks on a character change, gap, and stop', () => {
  const f = fixture()
  const old = f.subscriptions.get('events')
  f.send('events', samples(action(16, 1)))
  f.send('session', batch({ ...session, characterGeneration: 2 }))
  expect(old?.dispose).toHaveBeenCalledOnce()
  old?.receive(samples(action(16, 2)))
  expect(f.last()).toMatchObject({ epoch: 2, actions: [] })
  f.send('events', { complete: false, items: [] })
  expect(f.last()).toMatchObject({ epoch: 3, actions: [], statuses: [] })
  void f.stop()
  expect(f.subscriptions.get('session')?.dispose).toHaveBeenCalledOnce()
})
