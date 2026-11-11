import type { Batch, PluginContext, Value } from '@ffcafe/mojito-plugin-sdk'
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
    services: {
      connect: async () => ({ service: 'CombatStatistics/overlay', version: '1.0.0' }),
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
  const send = async (revision: number, encounterId: string) =>
    listener({
      subscriptionId: 'synthetic',
      batchId: revision,
      firstSeq: revision,
      lastSeq: revision,
      initial: false,
      complete: true,
      items: [{ revision, state: state(encounterId) } as unknown as Value],
    })
  return {
    ctx,
    initial,
    closed,
    send,
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
  expect(h.request).toHaveBeenLastCalledWith('CombatStatistics/overlay', 'endEncounter', {
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
