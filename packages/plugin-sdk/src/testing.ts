import { createPluginContext, type Hello } from './client.js'
import { PluginError, pluginError } from './errors.js'
import type { Limits } from './limits.js'
import type { Envelope } from './messages.js'
import { RpcClient } from './transport.js'
import type { Value } from './types.js'

/** Explicit opt-in fake context. Samples and service handlers are supplied by the test, never bundled. */
export function createTestContext(
  hello: Hello,
  limits: Limits,
  methods: Readonly<Record<string, (params: Value, signal: AbortSignal) => Value | Promise<Value>>> = {},
) {
  let receive: (message: unknown) => void = () => {}
  const requests: { method: string; params: Value }[] = []
  const calls = new Map<number, AbortController>()
  const subscriptions = new Map<
    string,
    { topic: string; params: Value; next: number; batch: number; awaiting: boolean }
  >()
  const send = (kind: Envelope['kind'], fields: Record<string, Value>) =>
    receive({ protocol: 1, activationId: hello.identity.activationId, kind, ...structuredClone(fields) })
  const client = new RpcClient(
    {
      listen: (handler) => {
        receive = handler
        return () => {
          receive = () => {}
        }
      },
      close: () => {
        for (const controller of calls.values()) controller.abort()
        calls.clear()
        subscriptions.clear()
      },
      send(message) {
        if (message.kind === 'request') {
          const id = message.id as number
          const method = String(message.method)
          requests.push({ method, params: structuredClone(message.params) })
          const controller = new AbortController()
          calls.set(id, controller)
          void Promise.resolve()
            .then(() => {
              const handler = methods[method]
              if (!handler) throw pluginError('unavailable', `No test handler for ${method}`)
              return handler(message.params, controller.signal)
            })
            .then((value) => send('response', { id, ok: true, value }))
            .catch((error) => {
              const reason = error instanceof PluginError ? error : pluginError('internal')
              send('response', { id, ok: false, error: { ...reason.toJSON() } })
            })
            .finally(() => calls.delete(id))
        } else if (message.kind === 'cancel') calls.get(message.id as number)?.abort()
        else if (message.kind === 'subscribe') {
          const id = `test-${message.id}`
          subscriptions.set(id, {
            topic: String(message.topic),
            params: message.params,
            next: 0,
            batch: 0,
            awaiting: false,
          })
          queueMicrotask(() => send('subscribed', { id: message.id, subscriptionId: id }))
        } else if (message.kind === 'ack') {
          const subscription = subscriptions.get(String(message.subscriptionId))
          if (subscription && message.batchId === subscription.batch - 1) subscription.awaiting = false
        } else if (message.kind === 'unsubscribe') subscriptions.delete(String(message.subscriptionId))
      },
    },
    hello.identity.activationId,
    limits,
  )
  return {
    context: createPluginContext(client, hello),
    requests,
    publish(topic: string, items: Value[], options: { initial?: boolean; match?: (params: Value) => boolean } = {}) {
      for (const [id, sub] of subscriptions) {
        if (sub.topic !== topic || (options.match && !options.match(sub.params))) continue
        if (sub.awaiting) throw new Error('Test consumer has not acknowledged its prior batch')
        const firstSeq = sub.next
        sub.next += Math.max(1, items.length)
        sub.awaiting = true
        send('batch', {
          subscriptionId: id,
          batchId: sub.batch++,
          firstSeq,
          lastSeq: sub.next - 1,
          initial: options.initial ?? false,
          complete: true,
          items,
        })
      }
    },
    close: () => client.close(),
  }
}
