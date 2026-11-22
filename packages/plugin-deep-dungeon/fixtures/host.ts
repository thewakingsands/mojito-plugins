import type {
  Batch,
  CombatantState,
  Field,
  GameTopics,
  PluginContext,
  Sample,
  SessionSnapshot,
  Value,
  ViewIdentity,
} from '@ffcafe/mojito-plugin-sdk'

export const ok = <T>(value: T): Field<T> => ({
  state: 'ok',
  value,
  observedAt: 1000,
  timeBase: 'host-monotonic-unix',
  from: 'memory',
})
export const batch = <T>(items: T[], complete = true): Batch<T> => ({
  subscriptionId: 'synthetic',
  batchId: 0,
  firstSeq: 0,
  lastSeq: items.length,
  initial: true,
  complete,
  items,
})
export const sample = <T>(value: T): Sample<T> => ({
  value,
  meta: {
    sessionId: 'synthetic',
    characterGeneration: 0,
    source: 'live',
    observedAt: 1000,
    timeBase: 'host-monotonic-unix',
    clockGeneration: 0,
    sampleStartedAt: null,
    sampleEndedAt: null,
  },
})
export const entity = (id = 101, nameId = 910001): CombatantState => ({
  id,
  objectKind: ok(2),
  subKind: ok(5),
  name: ok('训练石像'),
  bNpcName: ok(nameId),
  hpCur: ok(7500),
  hpMax: ok(10000),
})
type Listener = (input: Batch<Sample<any>>) => void
export function fixtureHost() {
  const snapshots = new Map<string, Value>()
  const watchers = new Map<string, Set<(value: Value) => void>>()
  const commands = new Map<string, (input: Value, view: ViewIdentity) => Value | Promise<Value>>()
  const requests: { method: string; args: unknown[] }[] = []
  const subscriptions: {
    topic: keyof GameTopics
    listener: Listener
    options: unknown
    disposed: boolean
    dispose(): void
    close(): void
  }[] = []
  let config: Value = null
  let session = { uiLanguage: 'zh-CN', dataLanguage: 'chs' } as SessionSnapshot
  const ctx = {
    signal: new AbortController().signal,
    session: { get: async () => session },
    game: {
      subscribe(topic: keyof GameTopics, listener: Listener, options: unknown) {
        let close!: () => void
        const closed = new Promise<{ reason: string }>((resolve) => {
          close = () => resolve({ reason: 'source_changed' })
        })
        const sub = {
          topic,
          listener,
          options,
          disposed: false,
          ready: Promise.resolve(),
          closed,
          dispose() {
            sub.disposed = true
          },
          close,
        }
        subscriptions.push(sub)
        return sub
      },
    },
    data: {
      rows: async (...args: unknown[]) => {
        requests.push({ method: 'data.rows', args })
        return []
      },
    },
    config: {
      get: async () => config,
      set: async (_key: string, value: Value) => {
        config = value
      },
    },
    views: {
      set(channel: string, value: Value) {
        snapshots.set(channel, value)
        for (const receive of watchers.get(channel) ?? []) receive(value)
      },
      flush: async () => {},
      onCommand: async (channel: string, callback: (input: Value, view: ViewIdentity) => Value | Promise<Value>) => {
        commands.set(channel, callback)
        return () => {
          commands.delete(channel)
        }
      },
    },
    ui: {
      registerOverlay: async (...args: unknown[]) => {
        requests.push({ method: 'ui.registerOverlay', args })
        return () => {}
      },
      registerFeature: async (...args: unknown[]) => {
        requests.push({ method: 'ui.registerFeature', args })
        return () => {}
      },
    },
    log: { debug() {}, warn() {} },
  } as unknown as PluginContext
  return {
    ctx,
    snapshots,
    watchers,
    commands,
    subscriptions,
    requests,
    session: (patch: Partial<SessionSnapshot>) => {
      session = { ...session, ...patch }
    },
    publish<T extends keyof GameTopics>(topic: T, value: GameTopics[T], complete = true) {
      for (const sub of [...subscriptions])
        if (sub.topic === topic && !sub.disposed) sub.listener(batch([sample(value)], complete))
    },
  }
}
