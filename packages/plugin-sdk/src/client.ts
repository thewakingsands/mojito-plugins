import { ClientClock, clockState } from './clock.js'
import type { CallContext, PluginContext } from './context.js'
import { pluginError } from './errors.js'
import { limitsSnapshot } from './limits.js'
import type { Envelope } from './messages.js'
import type { RpcClient } from './transport.js'
import type {
  BatchListener,
  Capability,
  Disposer,
  PluginIdentity,
  SubscribeOptions,
  Subscription,
  Value,
  ViewIdentity,
} from './types.js'
import { ViewSender } from './view-sender.js'

export interface Hello {
  apiVersion: '1.0.0'
  identity: PluginIdentity
  capabilities: { supported: Record<string, Capability>; granted: string[] }
  clock: ReturnType<ClientClock['state']>
}

export function object(value: Value): Record<string, Value> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Uint8Array)
    throw pluginError('invalid_argument')
  return value
}
export function decodeHello(message: Envelope): Hello {
  const identity = object(message.identity)
  if (
    message.kind !== 'hello' ||
    message.apiVersion !== '1.0.0' ||
    identity.activationId !== message.activationId ||
    typeof identity.id !== 'string' ||
    typeof identity.version !== 'string' ||
    !['production', 'development'].includes(String(identity.environment)) ||
    !['worker', 'native'].includes(String(identity.mode))
  ) {
    throw pluginError('incompatible_version')
  }
  limitsSnapshot(message.limits)
  const capabilities = decodeCapabilities(message.capabilities)
  return {
    apiVersion: '1.0.0',
    identity: identity as unknown as PluginIdentity,
    capabilities,
    clock: clockState(message.clock),
  }
}

function decodeCapabilities(input: Value): Hello['capabilities'] {
  const value = object(input)
  const supported = object(value.supported)
  if (!Array.isArray(value.granted) || value.granted.some((item) => typeof item !== 'string'))
    throw pluginError('invalid_argument')
  for (const entry of Object.values(supported)) {
    const capability = object(entry)
    if (
      capability.state !== 'available' &&
      !(capability.state === 'unavailable' && typeof capability.reason === 'string')
    )
      throw pluginError('invalid_argument')
  }
  return structuredClone(value) as unknown as Hello['capabilities']
}

function options(input?: SubscribeOptions): Record<string, Value> {
  if (!input) return {}
  const { signal: _signal, ...rest } = input
  return rest as Record<string, Value>
}

type Call = <T>(method: string, params: unknown, options?: SubscribeOptions) => Promise<T>
type Subscribe = <T>(
  topic: string,
  params: unknown,
  listener: BatchListener<T>,
  options?: SubscribeOptions,
) => Subscription
function readers(call: Call, subscribe: Subscribe): Omit<CallContext, 'signal'> {
  return {
    session: {
      get: (opts) => call('session.get', null, opts),
      subscribe: (listener, opts) => subscribe('session', null, listener, opts),
    },
    game: {
      getPlayer: (selection, opts) => call('game.getPlayer', selection, opts),
      getCombatants: (selection, opts) => call('game.getCombatants', selection, opts),
      subscribe: (topic, listener, opts) => subscribe('game', { topic, ...options(opts) }, listener, opts),
    },
    events: { subscribe: (type, listener, opts) => subscribe('events', { type, ...options(opts) }, listener, opts) },
    packets: {
      subscribe: (selector, listener, opts) => subscribe('packets', { selector, ...options(opts) }, listener, opts),
    },
    memory: {
      resolve: (signature, opts) => call('memory.resolve', { signature, ...options(opts) }, opts),
      read: (selection, opts) => call('memory.read', selection, opts),
      watch: (selection, listener, opts) => subscribe('memory', { selection, ...options(opts) }, listener, opts),
    },
    data: {
      rowIds: (sheet, language, opts) => call('data.rowIds', { sheet, language }, opts),
      resource: (path, opts) => call('data.resource', { path }, opts),
      image: (path, opts) => call('data.image', { path }, opts),
      map: (id, opts) => call('data.map', { id }, opts),
      icon: (id, opts) => call('data.icon', { id }, opts),
      name: (kind, id, language, opts) => call('data.name', { kind, id, language }, opts),
      rows: (sheet, ids, language, opts) => call('data.rows', { sheet, ids, language }, opts),
      version: (opts) => call('data.version', {}, opts),
    },
  }
}

/** Builds the public browser facade over a host-bound activation; it never grants permissions. */
export function createPluginContext(client: RpcClient, hello: Hello): PluginContext {
  const identity = Object.freeze({ ...hello.identity })
  if (identity.activationId !== client.activationId) throw pluginError('invalid_argument')
  let capabilities = structuredClone(hello.capabilities)
  const clock = new ClientClock(hello.clock)
  client.onControl((message) => {
    if (message.kind === 'capabilitiesChanged') capabilities = decodeCapabilities(message.capabilities)
    if (message.kind === 'clockSync' || message.kind === 'clockReset') {
      const state = clockState(message.state)
      if (typeof message.rate !== 'number') throw pluginError('invalid_argument')
      clock.sync(state, message.rate)
    }
  })
  const call = <T>(method: string, params: unknown, opts?: SubscribeOptions) =>
    client.request(method, params as Value, opts) as Promise<T>
  const subscribe: Subscribe = (topic, params, listener, opts) =>
    client.subscribe(topic, params as Value, listener, opts)
  const register = async (method: string, params: unknown, opts?: SubscribeOptions): Promise<Disposer> => {
    const registrationId = await call<string>(method, params, opts)
    let active = true
    return async () => {
      if (!active) return
      active = false
      try {
        if (!client.signal.aborted) await call(`${method}.dispose`, { registrationId })
      } catch (error) {
        active = true
        throw error
      }
    }
  }
  const commands = new Map<string, Parameters<PluginContext['views']['onCommand']>[1]>()
  client.handle('views.command', async (params) => {
    const { channel, payload, view } = object(params)
    const handler = commands.get(String(channel))
    if (!handler) throw pluginError('not_found')
    return handler(payload, view as unknown as ViewIdentity)
  })
  const providers = new Map<string, Parameters<PluginContext['services']['provide']>[1]>()
  const log = (level: string, message: string, fields?: Value) => {
    void call('log.write', { level, message, ...(fields === undefined ? {} : { fields }) }).catch(() => {})
  }
  const viewSender = new ViewSender(
    (channel, payload) => call('views.set', { channel, payload }),
    (message, fields) => log('warn', message, fields),
    client.signal,
  )
  const context: PluginContext = {
    identity,
    limits: client.limits,
    signal: client.signal,
    capabilities: { get: () => structuredClone(capabilities) },
    ...readers(call, subscribe),
    ui: {
      registerFeature: (definition, opts) => register('ui.registerFeature', definition, opts),
      registerOverlay: (definition, opts) => register('ui.registerOverlay', definition, opts),
      setPreferenceItems: async (items) => {
        await call('ui.setPreferenceItems', { items })
      },
    },
    views: {
      set: (channel, payload) => viewSender.set(channel, payload),
      flush: (opts) => viewSender.flush(opts),
      onCommand: async (channel, handler, opts) => {
        if (commands.has(channel)) throw pluginError('invalid_argument')
        commands.set(channel, handler)
        try {
          const release = await register('views.onCommand', { channel }, opts)
          let active = true
          return async () => {
            if (!active) return
            active = false
            try {
              await release()
              if (commands.get(channel) === handler) commands.delete(channel)
            } catch (error) {
              active = true
              throw error
            }
          }
        } catch (error) {
          commands.delete(channel)
          throw error
        }
      },
    },
    audio: {
      say: (text, opts) => call('audio.say', { text, ...options(opts) }, opts),
      play: (resource, opts) => call('audio.play', { ...resource, ...options(opts) }, opts),
    },
    host: {
      chooseFile: (selection, opts) => call('host.chooseFile', selection, opts),
      readFile: (token, opts) => call('host.readFile', { token }, opts),
      writeFile: (token, bytes, opts) => call('host.writeFile', { token, bytes }, opts),
      openExternal: (url, opts) => call('host.openExternal', { url }, opts),
    },
    http: { request: (url, opts) => call('http.request', { url, ...options(opts) }, opts) },
    config: {
      get: (key, opts) => call('config.get', { key }, opts),
      set: (key, payload, opts) => call('config.set', { key, payload }, opts),
    },
    storage: {
      read: (path, opts) => call('storage.read', { path }, opts),
      write: (path, bytes, opts) => call('storage.write', { path, bytes }, opts),
      delete: (path, opts) => call('storage.delete', { path }, opts),
      list: (path, opts) => call('storage.list', { path }, opts),
    },
    log: Object.fromEntries(
      ['debug', 'info', 'warn', 'error'].map((level) => [
        level,
        (message: string, fields?: Value) => log(level, message, fields),
      ]),
    ) as unknown as PluginContext['log'],
    notifications: {
      send: async ({ title, detail }, opts) => {
        await call('notifications.send', detail === undefined ? { title } : { title, detail }, opts)
      },
    },
    clock: {
      now: () => clock.now(),
      state: () => clock.state(),
      sleep: (ms, opts) => call('clock.sleep', { ms }, opts),
      setTimeout: (callback, ms) => {
        const controller = new AbortController()
        void call('clock.sleep', { ms }, { signal: controller.signal })
          .then(() => {
            if (!controller.signal.aborted && !client.signal.aborted) return callback()
          })
          .catch(() => {})
        return () => controller.abort()
      },
    },
    services: {
      provide: async (definition, handler, opts) => {
        if (providers.has(definition.name)) throw pluginError('invalid_argument')
        providers.set(definition.name, handler)
        try {
          const release = await register('services.provide', definition, opts)
          let active = true
          return async () => {
            if (!active) return
            active = false
            try {
              await release()
              if (providers.get(definition.name) === handler) providers.delete(definition.name)
            } catch (error) {
              active = true
              throw error
            }
          }
        } catch (error) {
          providers.delete(definition.name)
          throw error
        }
      },
      publish: (name, event, payload, opts) => call('services.publish', { name, event, payload }, opts),
      connect: (name, versionRange, opts) => call('services.connect', { name, versionRange }, opts),
      request: (providerId, name, method, payload, opts) =>
        call('services.request', { providerId, name, method, payload }, opts),
      subscribe: (selector, listener, opts) => client.subscribe('services', selector as Value, listener, opts),
    },
  }
  client.handle('services.call', async (params, signal) => {
    const request = object(params)
    const handler = providers.get(String(request.name))
    if (!handler || typeof request.callId !== 'string') throw pluginError('not_found')
    const callId = request.callId
    // Host routes every operation under this opaque callId through the permission intersection.
    const scoped = readers(
      (method, params, opts) => call('services.callRequest', { callId, method, params }, opts ?? { signal }),
      (topic, params, listener, opts) =>
        subscribe('services.callSubscribe', { callId, topic, params }, listener, opts ?? { signal }),
    )
    return handler({ method: String(request.method), payload: request.payload }, { ...scoped, signal })
  })
  client.signal.addEventListener(
    'abort',
    () => {
      commands.clear()
      providers.clear()
    },
    { once: true },
  )
  return Object.freeze(context)
}
