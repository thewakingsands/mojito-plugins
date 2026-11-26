import type { Batch, PluginContext, SessionSnapshot, Value } from '@ffcafe/mojito-plugin-sdk'
import type { OverlayState } from '@ffcafe/mojito-plugin-sdk/overlayplugin'
import { expect, it, vi } from 'vitest'
import { activateOverlay } from './worker.js'

const definition = {
  id: 'skyline',
  name: 'Skyline',
  protocol: 'modern' as const,
  entry: 'index.html',
  documents: ['index.html'],
}
const state = (encounterId: string): OverlayState => ({
  apiVersion: 1,
  encounterId,
  combatData: null,
  primaryPlayer: null,
  zone: null,
  language: null,
  inCombat: null,
  availability: Object.fromEntries(
    ['combatData', 'primaryPlayer', 'zone', 'language', 'inCombat'].map((key) => [
      key,
      { state: 'unavailable', reason: 'Synthetic missing data' },
    ]),
  ) as OverlayState['availability'],
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function fixture() {
  const initial = deferred<Value>(),
    closed = deferred<{ reason: string }>()
  let listener!: (batch: Batch<Value>) => Promise<void>
  let identityAllowed = true
  let sessionListener!: (batch: { items: Partial<SessionSnapshot>[] }) => Promise<void>
  let command!: (input: Value) => Promise<Value>
  const calls: string[] = [],
    values: Value[] = []
  const dispose = vi.fn(),
    removeOverlay = vi.fn(),
    removeCommand = vi.fn()
  const request = vi.fn(async (_service: string, method: string) =>
    method === 'getState' ? initial.promise : { result: 'ended' },
  )
  const ctx = {
    signal: new AbortController().signal,
    capabilities: { get: () => ({ 'identity.read': { state: identityAllowed ? 'available' : 'denied' } }) },
    session: {
      subscribe: (receive: typeof sessionListener) => {
        sessionListener = receive
        return { ready: Promise.resolve(), dispose: vi.fn() }
      },
    },
    services: {
      connect: async () => ({ service: 'ffcafe.combat-statistics/overlay', version: '1.0.0' }),
      request,
      subscribe: (_selector: unknown, receive: typeof listener) => {
        listener = receive
        return { ready: Promise.resolve(), closed: closed.promise, dispose }
      },
    },
    views: {
      set: (_channel: string, value: Value) => {
        calls.push('set')
        values.push(value)
      },
      flush: async () => {
        calls.push('flush')
      },
      onCommand: async (_channel: string, handler: typeof command) => {
        command = handler
        return removeCommand
      },
    },
    ui: { registerOverlay: vi.fn(async () => removeOverlay) },
    log: { warn: vi.fn(), error: vi.fn() },
  } as unknown as PluginContext
  const send = async (revision: number, next: string | OverlayState) =>
    listener({
      subscriptionId: 'synthetic',
      batchId: revision,
      firstSeq: revision,
      lastSeq: revision,
      initial: false,
      complete: true,
      items: [{ revision, state: typeof next === 'string' ? state(next) : next } as unknown as Value],
    })
  return {
    ctx,
    initial,
    closed,
    send,
    async allowIdentity(allowed: boolean) {
      identityAllowed = allowed
      await sessionListener({
        items: [{ capabilities: ctx.capabilities.get(), character: { actorId: 0x10000001, contentId: null } }],
      })
    },
    calls,
    values,
    request,
    dispose,
    removeOverlay,
    removeCommand,
    command: (input: Value) => command(input),
  }
}
it('keeps a newer event when the initial snapshot arrives late and flushes encounter transitions', async () => {
  const h = fixture(),
    activation = activateOverlay(h.ctx, definition)
  await vi.waitFor(() => expect(h.request).toHaveBeenCalled())
  await h.send(2, 'newer')
  h.initial.resolve({ revision: 1, state: state('older') } as unknown as Value)
  const stop = await activation
  expect(h.values).toHaveLength(1)
  expect(h.values[0]).toMatchObject({ encounterId: 'newer' })
  await h.send(3, 'next')
  expect(h.calls.slice(-2)).toEqual(['flush', 'set'])
  await h.command({ kind: 'endEncounter', encounterId: 'newer' })
  expect(h.request).toHaveBeenLastCalledWith('ffcafe.combat-statistics/overlay', 'endEncounter', {
    encounterId: 'newer',
  })
  await stop()
  await stop()
  expect(h.values.at(-1)).toBeNull()
  expect(h.removeOverlay).toHaveBeenCalledOnce()
})
it('cancels a late snapshot after the provider stops before activation completes', async () => {
  const h = fixture(),
    activation = activateOverlay(h.ctx, definition)
  const rejected = expect(activation).rejects.toMatchObject({ code: 'cancelled' })
  await vi.waitFor(() => expect(h.request).toHaveBeenCalled())
  h.closed.resolve({ reason: 'permission_denied' })
  await vi.waitFor(() => expect(h.dispose).toHaveBeenCalledOnce())
  h.initial.resolve({ revision: 1, state: state('late') } as unknown as Value)
  await rejected
  expect(h.values.every((value) => value === null)).toBe(true)
  expect(h.ctx.ui.registerOverlay).not.toHaveBeenCalled()
})
it('clears and unregisters a running overlay when service authorization ends', async () => {
  const h = fixture(),
    activation = activateOverlay(h.ctx, definition)
  h.initial.resolve({ revision: 8, state: state('current') } as unknown as Value)
  const stop = await activation
  h.closed.resolve({ reason: 'permission_denied' })
  await vi.waitFor(() => expect(h.removeOverlay).toHaveBeenCalledOnce())
  await h.send(9, 'stale')
  await stop()
  expect(h.values.at(-1)).toBeNull()
  expect(h.values).not.toContainEqual(expect.objectContaining({ encounterId: 'stale' }))
  await expect(h.command({ kind: 'endEncounter', encounterId: 'current' })).rejects.toMatchObject({
    code: 'unavailable',
  })
})

it('masks cached names immediately on revocation and restores the same revision on regrant', async () => {
  const h = fixture()
  const frame: OverlayState = {
    ...state('synthetic'),
    combatData: {
      Encounter: { damage: '100' },
      Combatant: {
        YOU: { name: 'YOU', Job: 'PLD' },
        'Synthetic Ally@42 [10000420]': { name: 'Synthetic Ally', Job: 'WHM', damage: '80' },
        'Limit Break': { name: 'Limit Break', Job: 'Limit Break', damage: '20' },
      },
      isActive: 'true',
    },
    primaryPlayer: { id: 0x10000320, name: 'Synthetic Self' },
    custom: { name: 'Synthetic Provider Custom' },
  }
  frame.availability.combatData = frame.availability.primaryPlayer = { state: 'available' }
  h.initial.resolve({ revision: 1, state: frame } as unknown as Value)
  const stop = await activateOverlay(h.ctx, { ...definition, id: 'ember' })
  expect(h.values.at(-1)).toMatchObject({ primaryPlayer: frame.primaryPlayer })
  await h.allowIdentity(false)
  const redacted = h.values.at(-1)
  expect(JSON.stringify(redacted)).not.toMatch(/Synthetic (Ally|Self|Provider)|10000420/)
  expect(redacted).toMatchObject({
    primaryPlayer: { id: 0x10000001, name: 'Player' },
    combatData: {
      Encounter: { damage: '100', mojitoIdentity: 'masked' },
      Combatant: { YOU: { name: 'YOU' }, 'Player 2': { Job: 'WHM', damage: '80' }, 'Limit Break': { damage: '20' } },
    },
  })
  expect(h.calls.at(-1)).toBe('flush')

  await h.send(1, frame)
  expect(h.values.at(-1)).toEqual(redacted)
  await h.allowIdentity(true)
  expect(h.values.at(-1)).toMatchObject({
    primaryPlayer: frame.primaryPlayer,
    combatData: { Encounter: { mojitoIdentity: 'visible' }, Combatant: frame.combatData?.Combatant },
  })
  await stop()
})

it('uses stand-in identity supplied by the host without rewriting it again', async () => {
  const h = fixture()
  const frame = state('synthetic')
  frame.primaryPlayer = { id: 0x10000001, name: 'HyPLD' }
  frame.availability.primaryPlayer = { state: 'available' }
  frame.custom = { identityMasked: true }
  h.initial.resolve({ revision: 1, state: frame } as unknown as Value)
  const stop = await activateOverlay(h.ctx, definition)
  await h.allowIdentity(false)
  expect(h.values.at(-1)).toMatchObject({ primaryPlayer: frame.primaryPlayer })
  expect(h.values.at(-1)).not.toHaveProperty('custom')
  await stop()
})
