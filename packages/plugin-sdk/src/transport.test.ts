import { beforeEach, expect, it, vi } from 'vitest'
import { iterateBatches } from './iterate.js'
import { limitNames, limitsSnapshot } from './limits.js'
import type { Envelope } from './messages.js'
import { messagePortTransport, RpcClient, type Transport } from './transport.js'

let receive: (value: unknown) => void
let disconnect: () => void
let sent: Envelope[]
let client: RpcClient
const emit = (kind: Envelope['kind'], fields = {}) => receive({ protocol: 1, activationId: 'test', kind, ...fields })
const batch = (id = 0) =>
  emit('batch', {
    subscriptionId: 'sub',
    batchId: id,
    firstSeq: id,
    lastSeq: id,
    initial: id === 0,
    complete: true,
    items: [1n],
  })
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}
beforeEach(() => {
  sent = []
  const transport: Transport = {
    send: (message) => sent.push(structuredClone(message)),
    listen: (handler, close) => {
      receive = handler
      disconnect = close
      return () => {}
    },
    close: () => {},
  }
  const values = Object.fromEntries(limitNames.map((key) => [key, 128]))
  client = new RpcClient(transport, 'test', limitsSnapshot({ schemaVersion: 1, revision: 'test', values }))
})
it('revokes calls and aborts before trusted cleanup without closing its acknowledgement port', async () => {
  const close = vi.fn(),
    detach = vi.fn()
  const local = new RpcClient(
    {
      send() {},
      listen() {
        return detach
      },
      close,
    },
    'cleanup',
    client.limits,
  )
  const pending = local.request('config.get', null)
  const rejected = expect(pending).rejects.toMatchObject({ code: 'plugin_stopped' })
  local.close(undefined, true)
  expect(local.signal.aborted).toBe(true)
  await rejected
  expect(detach).toHaveBeenCalledOnce()
  expect(close).not.toHaveBeenCalled()
  await expect(local.request('config.set', null)).rejects.toMatchObject({ code: 'plugin_stopped' })
  const ordinary = new RpcClient(
    {
      send() {},
      listen() {
        return () => {}
      },
      close,
    },
    'ordinary',
    client.limits,
  )
  ordinary.close()
  expect(close).toHaveBeenCalledOnce()
})
it('passes host events to the control listeners', () => {
  const listener = vi.fn()
  client.onControl(listener)
  emit('event', { name: 'navigate-to-preference-item', value: { id: 'color', keyword: 'ys' } })
  expect(listener).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: 'event',
      name: 'navigate-to-preference-item',
      value: { id: 'color', keyword: 'ys' },
    }),
  )
})
it('cancels requests once and ignores late success without reusing an ID', async () => {
  const abort = new AbortController()
  const request = client.request('config.get', { key: 'x' }, { signal: abort.signal })
  abort.abort()
  abort.abort()
  await expect(request).rejects.toMatchObject({ code: 'cancelled' })
  emit('response', { id: 0, ok: true, value: 1n })
  const next = client.request('config.get', null)
  emit('response', { id: 1, ok: true, value: 2n })
  expect(await next).toBe(2n)
  expect(sent.map((value) => value.kind)).toEqual(['request', 'cancel', 'request'])
})
it('acknowledges only after the async listener succeeds', async () => {
  let finish!: () => void
  const listener = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  const sub = client.subscribe('events.castStarted', null, listener)
  emit('subscribed', { id: 0, subscriptionId: 'sub' })
  await sub.ready
  batch()
  await settle()
  expect(listener).toHaveBeenCalledOnce()
  expect(sent.some((value) => value.kind === 'ack')).toBe(false)
  finish()
  await settle()
  expect(sent.at(-1)).toMatchObject({ kind: 'ack', batchId: 0 })
})
it('cancels a registration and disposes a late subscribed result', async () => {
  const sub = client.subscribe('events.castStarted', null, () => {})
  sub.dispose()
  await expect(sub.ready).rejects.toMatchObject({ code: 'cancelled' })
  emit('subscribed', { id: 0, subscriptionId: 'sub' })
  expect(sent.map((value) => value.kind)).toEqual(['subscribe', 'cancel', 'unsubscribe'])
  expect(await sub.closed).toEqual({ reason: 'cancelled' })
})
it('ends only the throwing listener and does not ack it', async () => {
  const sub = client.subscribe('events.castStarted', null, () => {
    throw new Error('synthetic')
  })
  emit('subscribed', { id: 0, subscriptionId: 'sub' })
  batch()
  expect(await sub.closed).toMatchObject({ reason: 'listener_error', error: { code: 'internal' } })
  expect(sent.at(-1)).toMatchObject({ kind: 'unsubscribe' })
  expect(client.signal.aborted).toBe(false)
})
it('does not ack a running callback after overflow or deliver cached batches', async () => {
  let finish!: () => void
  const listener = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  const sub = client.subscribe('packets.ipc', null, listener)
  emit('subscribed', { id: 0, subscriptionId: 'sub' })
  batch()
  await settle()
  emit('subscriptionClosed', {
    subscriptionId: 'sub',
    reason: 'overflow',
    lastDeliveredSeq: 0,
    error: { code: 'overflow', message: 'Full', retryable: false },
  })
  batch(1)
  finish()
  await settle()
  expect(await sub.closed).toMatchObject({ reason: 'overflow' })
  expect(listener).toHaveBeenCalledOnce()
  expect(sent.some((value) => value.kind === 'ack')).toBe(false)
})
it.each(['duplicate', 'unacked', 'activation'])('closes on %s protocol violation', async (kind) => {
  const sub = client.subscribe('events', null, async () => {})
  emit('subscribed', { id: 0, subscriptionId: 'sub' })
  if (kind === 'activation') receive({ protocol: 1, activationId: 'other', kind: 'stop' })
  else {
    batch()
    if (kind === 'duplicate') await settle()
    batch(kind === 'duplicate' ? 0 : 1)
  }
  expect((await sub.closed).error?.code).toBe('internal')
  expect(client.signal.aborted).toBe(true)
})
it('disconnect cancels outstanding custom-signal requests as plugin_stopped', async () => {
  const request = client.request('data.rows', null, { signal: new AbortController().signal })
  const sub = client.subscribe('game.player', null, () => {})
  disconnect()
  await expect(request).rejects.toMatchObject({ code: 'plugin_stopped' })
  await expect(sub.ready).rejects.toMatchObject({ code: 'plugin_stopped' })
  expect(sent.map((value) => value.kind)).toEqual(['request', 'subscribe'])
})
it('a for-await break disposes without an extra ack', async () => {
  const stream = iterateBatches<bigint>((listener) => client.subscribe('packets', null, listener))
  emit('subscribed', { id: 0, subscriptionId: 'sub' })
  batch()
  for await (const value of stream) {
    expect(value.items).toEqual([1n])
    break
  }
  await settle()
  expect(sent.map((value) => value.kind)).toEqual(['subscribe', 'unsubscribe'])
})
it('iterator backpressure releases a batch only when the consumer advances', async () => {
  const stream = iterateBatches((listener) => client.subscribe('events', null, listener))
  emit('subscribed', { id: 0, subscriptionId: 'sub' })
  batch()
  await stream.next()
  await settle()
  expect(sent.some((value) => value.kind === 'ack')).toBe(false)
  const pending = stream.next()
  await settle()
  expect(sent.at(-1)).toMatchObject({ kind: 'ack', batchId: 0 })
  batch(1)
  expect((await pending).value?.batchId).toBe(1)
  await stream.return!()
})
it('cancels host callback requests before dispatch and suppresses late callback results', async () => {
  const handler = vi.fn(() => 42)
  client.handle('views.command', handler)
  emit('request', { id: 0, method: 'views.command', params: null })
  emit('cancel', { id: 0 })
  await settle()
  expect(handler).not.toHaveBeenCalled()
  let finish!: (value: number) => void
  client.handle(
    'services.call',
    (_params, signal) =>
      new Promise<number>((resolve) => {
        finish = resolve
        signal.addEventListener('abort', () => {
          finish(99)
        })
      }),
  )
  emit('request', { id: 1, method: 'services.call', params: 1n })
  await settle()
  emit('cancel', { id: 1 })
  await settle()
  expect(sent).toEqual([])
  emit('request', { id: 2, method: 'views.command', params: null })
  await settle()
  expect(sent).toEqual([{ protocol: 1, activationId: 'test', kind: 'response', id: 2, ok: true, value: 42 }])
})
it('fails only the request whose params cannot be cloned', async () => {
  const { port1, port2 } = new MessageChannel()
  port2.onmessage = ({ data }) => {
    if (data.kind === 'request')
      port2.postMessage({ protocol: 1, activationId: 'clone', kind: 'response', id: data.id, ok: true, value: 'ok' })
  }
  const local = new RpcClient(messagePortTransport(port1), 'clone', client.limits)
  await expect(local.request('config.get', { callback: () => {} } as never)).rejects.toMatchObject({
    code: 'invalid_argument',
  })
  await expect(local.request('config.get', null)).resolves.toBe('ok')
  expect(local.signal.aborted).toBe(false)
  local.close()
  port2.close()
})

it('preserves typed errors from a separately bundled SDK and hides untyped failures', async () => {
  class BundledPluginError extends Error {
    code = 'permission_denied'
    retryable = false
  }
  client.handle('test', async () => {
    throw new BundledPluginError('permission_denied')
  })
  emit('request', { id: 0, method: 'test', params: null })
  await settle()
  expect(sent.find((message) => message.kind === 'response' && message.id === 0)).toMatchObject({
    ok: false,
    error: { code: 'permission_denied', message: 'permission_denied', retryable: false },
  })
  client.handle('untyped', async () => {
    throw new Error('private details')
  })
  emit('request', { id: 1, method: 'untyped', params: null })
  await settle()
  expect(sent.find((message) => message.kind === 'response' && message.id === 1)).toMatchObject({
    ok: false,
    error: { code: 'internal', message: 'Plugin handler failed' },
  })
})
