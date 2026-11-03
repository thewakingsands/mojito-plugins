import { object } from './client.js'
import { connectPort } from './connection.js'
import { pluginError } from './errors.js'
import type { BatchListener, SubscribeOptions, Subscription, Value, ViewEvents, ViewIdentity } from './types.js'

export interface ViewBridge {
  readonly identity: Readonly<ViewIdentity>
  snapshot(channel: string, options?: SubscribeOptions): Promise<Value>
  subscribe(channel: string, listener: BatchListener<Value>, options?: SubscribeOptions): Subscription
  command(channel: string, value: Value, options?: SubscribeOptions): Promise<Value>
  /**
   * Listens to an event the host sends to this page and returns a function that stops listening. An event that
   * arrives while it has no listener is kept, only the latest of each name, and given to the first listener added.
   * @since Plugin API 1.5.0
   */
  on<K extends keyof ViewEvents>(name: K, listener: (value: ViewEvents[K]) => void): () => void
}

let connected: Promise<ViewBridge> | undefined
/** Only a host-transferred, document-bound view port is accepted; no generic host invocation is exposed. */
export function connectView(): Promise<ViewBridge> {
  if (connected) return connected
  connected = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener('message', receive)
      reject(pluginError('timeout'))
    }, 10000)
    const receive = (event: MessageEvent) => {
      if (
        event.source !== window ||
        event.origin !== 'mojito-plugin://runtime' ||
        event.data?.type !== 'mojito:view-port' ||
        event.ports.length !== 1
      )
        return
      clearTimeout(timer)
      window.removeEventListener('message', receive)
      void connectPort(event.ports[0])
        .then(({ client, hello }) => {
          const identity = object(hello.viewIdentity)
          if (
            typeof identity.viewId !== 'string' ||
            typeof identity.definitionId !== 'string' ||
            (identity.kind !== 'feature' && identity.kind !== 'overlay') ||
            (identity.instanceId !== null && typeof identity.instanceId !== 'string')
          ) {
            client.close()
            throw pluginError('invalid_argument', 'Invalid view identity')
          }
          const listeners = new Map<string, Set<(value: Value) => void>>()
          const held = new Map<string, Value>()
          // Each listener runs on its own microtask, so one that throws does not keep the event from the others.
          const deliver = (name: string, listener: (value: Value) => void, value: Value) =>
            queueMicrotask(() => {
              if (listeners.get(name)?.has(listener)) listener(value)
            })
          client.onControl((message) => {
            if (message.kind === 'stop') client.close()
            if (message.kind !== 'event' || typeof message.name !== 'string') return
            const current = listeners.get(message.name)
            if (current?.size) for (const listener of current) deliver(message.name, listener, message.value)
            else held.set(message.name, message.value)
          })
          window.addEventListener('pagehide', () => client.close(), { once: true })
          client.send('ready')
          resolve(
            Object.freeze({
              identity: Object.freeze({ ...identity }) as unknown as ViewIdentity,
              snapshot: (channel: string, options?: SubscribeOptions) =>
                client.request('view.snapshot', { channel }, options),
              subscribe: (channel: string, listener: BatchListener<Value>, options?: SubscribeOptions) =>
                client.subscribe('view', { channel }, listener, options),
              command: (channel: string, payload: Value, options?: SubscribeOptions) =>
                client.request('view.command', { channel, payload }, options),
              on: ((name: string, listener: (value: Value) => void) => {
                // Each call is its own registration, even for a function that is already listening.
                const entry = (value: Value) => listener(value)
                const current = listeners.get(name) ?? new Set()
                listeners.set(name, current)
                current.add(entry)
                if (held.has(name)) {
                  deliver(name, entry, held.get(name)!)
                  held.delete(name)
                }
                return () => {
                  current.delete(entry)
                }
              }) as ViewBridge['on'],
            }),
          )
        })
        .catch(reject)
    }
    window.addEventListener('message', receive)
    window.postMessage({ type: 'mojito:view-connect' }, 'mojito-plugin://runtime')
  })
  return connected
}
