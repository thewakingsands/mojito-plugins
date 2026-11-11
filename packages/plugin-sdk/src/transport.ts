import { apiError, PluginError, pluginError } from './errors.js'
import type { Limits } from './limits.js'
import { type Envelope, validateEnvelope } from './messages.js'
import type { ApiError, Batch, BatchListener, SubscribeOptions, Subscription, Value } from './types.js'

/** One activation's private transport; adapters never accept an arbitrary IPC channel. */
export interface Transport {
  send(message: Envelope): void
  listen(receive: (message: unknown) => void, disconnected: () => void): () => void
  close(): void
}

export function messagePortTransport(port: MessagePort): Transport {
  return {
    send: (message) => port.postMessage(message),
    listen(receive, disconnected) {
      const message = (event: MessageEvent) => receive(event.data)
      port.addEventListener('message', message)
      port.addEventListener('messageerror', disconnected)
      port.start()
      return () => {
        port.removeEventListener('message', message)
        port.removeEventListener('messageerror', disconnected)
      }
    },
    close: () => port.close(),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  // A plugin may intentionally use only closed; ready must not leak an unhandled rejection.
  void promise.catch(() => {})
  return { promise, resolve, reject }
}

interface Pending {
  resolve(value: Value): void
  reject(error: PluginError): void
  cleanup(): void
  subscription?: ClientSubscription
}
interface ClientSubscription {
  requestId: number
  id?: string
  ready: ReturnType<typeof deferred<void>>
  closed: ReturnType<typeof deferred<{ reason: string; error?: ApiError }>>
  listener: BatchListener<Value>
  ended: boolean
  busy: boolean
  lastBatch: number
  lastSeq: number
  complete: boolean
  cleanup(): void
}

function integer(value: Value | undefined): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new TypeError('Invalid sequence')
  return value
}
function text(value: Value | undefined): string {
  if (typeof value !== 'string' || !value.length) throw new TypeError('Invalid identifier')
  return value
}

/** Serial consumption and exact ack, with bounded outstanding operations and no automatic retries. */
export class RpcClient {
  readonly signal: AbortSignal
  private readonly controller = new AbortController()
  private readonly pending = new Map<number, Pending>()
  private readonly subscriptions = new Map<string, ClientSubscription>()
  private readonly registering = new Set<ClientSubscription>()
  private nextId = 0
  private stopped = false
  private readonly controls = new Set<(message: Envelope) => void>()
  private readonly handlers = new Map<string, (params: Value, signal: AbortSignal) => Value | Promise<Value>>()
  private readonly incoming = new Map<number, AbortController>()
  private lastIncomingId = -1
  private detach: () => void = () => {}

  constructor(
    private readonly transport: Transport,
    readonly activationId: string,
    readonly limits: Limits,
    private readonly control: (message: Envelope) => void = () => {},
  ) {
    this.signal = this.controller.signal
    this.detach = transport.listen(
      (message) => {
        try {
          this.receive(message)
        } catch {
          this.close(pluginError('internal', 'Invalid host protocol message'))
        }
      },
      () => this.close(),
    )
  }

  onControl(listener: (message: Envelope) => void): () => void {
    this.controls.add(listener)
    return () => {
      this.controls.delete(listener)
    }
  }

  handle(method: string, handler: (params: Value, signal: AbortSignal) => Value | Promise<Value>): () => void {
    if (this.handlers.has(method)) throw pluginError('invalid_argument', 'Handler already registered')
    this.handlers.set(method, handler)
    return () => {
      if (this.handlers.get(method) === handler) this.handlers.delete(method)
    }
  }

  send(kind: Envelope['kind'], fields: Record<string, Value> = {}): void {
    if (this.stopped) throw pluginError('plugin_stopped')
    const message: Envelope = { ...fields, protocol: 1, activationId: this.activationId, kind }
    try {
      this.transport.send(message)
    } catch (error) {
      // postMessage rejects an uncloneable value before sending anything, so only this message fails.
      if (error instanceof Error && error.name === 'DataCloneError') throw pluginError('invalid_argument')
      this.close()
      throw pluginError('plugin_stopped')
    }
  }

  private id(): number {
    if (this.stopped) throw pluginError('plugin_stopped')
    if (this.nextId === Number.MAX_SAFE_INTEGER) throw pluginError('quota_exceeded', 'Activation request IDs exhausted')
    return this.nextId++
  }

  request(method: string, params: Value = null, options: SubscribeOptions = {}): Promise<Value> {
    const result = deferred<Value>()
    const signal = options.signal ?? this.signal
    let id: number
    try {
      if (this.stopped) throw pluginError('plugin_stopped')
      if (signal.aborted) throw pluginError('cancelled')
      id = this.id()
      const abort = () => {
        const pending = this.pending.get(id)
        if (!pending) return
        this.pending.delete(id)
        pending.cleanup()
        pending.reject(pluginError('cancelled'))
        if (!this.signal.aborted) this.send('cancel', { id })
      }
      const cleanup = () => signal.removeEventListener('abort', abort)
      this.pending.set(id, { resolve: result.resolve, reject: result.reject, cleanup })
      signal.addEventListener('abort', abort, { once: true })
      this.send('request', { id, method, params })
    } catch (error) {
      if (id! !== undefined) {
        this.pending.get(id!)?.cleanup()
        this.pending.delete(id!)
      }
      result.reject(error)
    }
    return result.promise
  }

  subscribe<T>(topic: string, params: Value, listener: BatchListener<T>, options: SubscribeOptions = {}): Subscription {
    const state: ClientSubscription = {
      requestId: -1,
      ready: deferred<void>(),
      closed: deferred(),
      listener: listener as BatchListener<Value>,
      ended: false,
      busy: false,
      lastBatch: -1,
      lastSeq: -1,
      complete: true,
      cleanup: () => {},
    }
    const signal = options.signal ?? this.signal
    const dispose = () => this.end(state, 'cancelled', undefined, true)
    try {
      if (this.stopped) throw pluginError('plugin_stopped')
      if (signal.aborted) throw pluginError('cancelled')
      state.requestId = this.id()
      state.cleanup = () => signal.removeEventListener('abort', dispose)
      this.registering.add(state)
      this.pending.set(state.requestId, {
        resolve: () => {},
        reject: (error) => this.end(state, error.code, error.toJSON()),
        cleanup: () => {},
        subscription: state,
      })
      signal.addEventListener('abort', dispose, { once: true })
      this.send('subscribe', { id: state.requestId, topic, params })
    } catch (error) {
      const reason = error instanceof PluginError ? error : pluginError('invalid_argument')
      this.end(state, reason.code, reason.toJSON())
    }
    return { ready: state.ready.promise, closed: state.closed.promise, dispose }
  }

  private end(state: ClientSubscription, reason: string, error?: ApiError, notify = false): void {
    if (state.ended) return
    state.ended = true
    state.cleanup()
    this.registering.delete(state)
    this.pending.delete(state.requestId)
    if (state.id) this.subscriptions.delete(state.id)
    state.ready.reject(error ? new PluginError(error) : pluginError('cancelled'))
    state.closed.resolve({ reason, ...(error ? { error } : {}) })
    if (notify && !this.signal.aborted && state.requestId >= 0) {
      if (state.id) this.send('unsubscribe', { subscriptionId: state.id })
      else this.send('cancel', { id: state.requestId })
    }
  }

  private receive(input: unknown): void {
    if (this.stopped) return
    validateEnvelope(input, this.activationId)
    switch (input.kind) {
      case 'request': {
        const id = integer(input.id)
        if (id <= this.lastIncomingId) throw new TypeError('Reused host request ID')
        this.lastIncomingId = id
        const method = text(input.method)
        const handler = this.handlers.get(method)
        if (!handler) {
          this.send('response', { id, ok: false, error: { ...pluginError('unavailable').toJSON() } })
          return
        }
        const controller = new AbortController()
        this.incoming.set(id, controller)
        void Promise.resolve()
          .then(() => {
            if (controller.signal.aborted) throw pluginError('cancelled')
            return handler(input.params, controller.signal)
          })
          .then((value) => {
            if (!controller.signal.aborted && !this.stopped) this.send('response', { id, ok: true, value })
          })
          .catch((error) => {
            if (!controller.signal.aborted && !this.stopped) {
              let reason: ApiError
              try {
                reason = apiError(error)
              } catch {
                reason = pluginError('internal', 'Plugin handler failed').toJSON()
              }
              this.send('response', { id, ok: false, error: { ...reason } })
            }
          })
          .finally(() => this.incoming.delete(id))
          .catch(() => this.close())
        break
      }
      case 'cancel': {
        this.incoming.get(integer(input.id))?.abort(pluginError('cancelled'))
        break
      }
      case 'response': {
        const id = integer(input.id)
        if (typeof input.ok !== 'boolean') throw new TypeError('Invalid response')
        if (!input.ok) apiError(input.error)
        const pending = this.pending.get(id)
        if (!pending) return // A late response to a cancelled operation cannot resurrect it.
        if (pending.subscription && input.ok) throw new TypeError('Expected subscribed')
        this.pending.delete(id)
        pending.cleanup()
        if (input.ok) pending.resolve(input.value)
        else pending.reject(new PluginError(apiError(input.error)))
        break
      }
      case 'subscribed': {
        const id = integer(input.id)
        const subscriptionId = text(input.subscriptionId)
        const pending = this.pending.get(id)
        if (!pending) {
          this.send('unsubscribe', { subscriptionId })
          return
        }
        const state = pending.subscription
        if (!state || this.subscriptions.has(subscriptionId)) throw new TypeError('Unexpected subscribed')
        this.pending.delete(id)
        this.registering.delete(state)
        state.id = subscriptionId
        this.subscriptions.set(subscriptionId, state)
        state.ready.resolve()
        break
      }
      case 'batch': {
        const id = text(input.subscriptionId)
        const state = this.subscriptions.get(id)
        if (!state) return
        const batchId = integer(input.batchId)
        const firstSeq = integer(input.firstSeq)
        const lastSeq = integer(input.lastSeq)
        if (
          state.busy ||
          batchId <= state.lastBatch ||
          firstSeq <= state.lastSeq ||
          lastSeq < firstSeq ||
          typeof input.initial !== 'boolean' ||
          typeof input.complete !== 'boolean' ||
          !Array.isArray(input.items) ||
          (!state.complete && input.complete)
        )
          throw new TypeError('Invalid batch order')
        state.busy = true
        state.lastBatch = batchId
        state.lastSeq = lastSeq
        state.complete = input.complete
        const batch: Batch<Value> = {
          subscriptionId: id,
          batchId,
          firstSeq,
          lastSeq,
          initial: input.initial,
          complete: input.complete,
          items: input.items,
        }
        // One outstanding batch bounds this promise chain, even for a hung user callback.
        void Promise.resolve()
          .then(() => {
            if (!state.ended) return state.listener(batch)
          })
          .then(() => {
            state.busy = false
            if (!state.ended) this.send('ack', { subscriptionId: id, batchId })
          })
          .catch(() => {
            this.end(
              state,
              'listener_error',
              { code: 'internal', message: 'Subscription listener failed', retryable: false },
              true,
            )
          })
        break
      }
      case 'subscriptionClosed': {
        const state = this.subscriptions.get(text(input.subscriptionId))
        if (state) this.end(state, text(input.reason), input.error === undefined ? undefined : apiError(input.error))
        break
      }
      case 'stop':
        this.control(input)
        for (const listener of this.controls) listener(input)
        break
      case 'capabilitiesChanged':
      case 'clockSync':
      case 'clockReset':
      case 'event':
        this.control(input)
        for (const listener of this.controls) listener(input)
        break
      default:
        throw new TypeError('Unexpected host message')
    }
  }

  /** The trusted runtime may retain the transport only long enough to send its final stopped acknowledgement. */
  close(error = pluginError('plugin_stopped'), keepTransportOpen = false): void {
    if (this.stopped) return
    this.stopped = true
    for (const pending of this.pending.values()) {
      pending.cleanup()
      pending.reject(error)
    }
    this.pending.clear()
    for (const state of [...this.registering, ...this.subscriptions.values()])
      this.end(state, error.code, error.toJSON())
    this.controller.abort(error)
    for (const controller of this.incoming.values()) controller.abort(error)
    this.incoming.clear()
    this.handlers.clear()
    this.controls.clear()
    this.detach()
    if (!keepTransportOpen) this.transport.close()
  }
}
