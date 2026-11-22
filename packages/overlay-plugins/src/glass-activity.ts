import type { Disposer, Json, PluginContext, SessionSnapshot, Subscription } from '@ffcafe/mojito-plugin-sdk'
import {
  addRecentAction,
  matchesActivitySource,
  pruneRecentActions,
  type RecentAction,
  recentActionFrame,
  sameActivitySource,
} from './recent-actions.js'

export function observeGlassActivity(
  ctx: PluginContext,
  publish: (value: Json, immediate?: boolean) => void,
): Disposer {
  let current: SessionSnapshot | undefined
  let active = true
  let epoch = 0
  let events: Subscription | undefined
  let generation = new AbortController()
  let actions: RecentAction[] = []
  let lastSnapshot: string | undefined
  let readingNames = false
  const names = new Map<number, string>()
  const queried = new Set<number>()

  function send(immediate = false) {
    if (!active || ctx.signal.aborted) return
    const now = ctx.clock.now()
    actions = pruneRecentActions(actions, now)
    const ids = new Set(actions.map(({ actorId }) => actorId))
    for (const id of queried) if (!ids.has(id)) queried.delete(id)
    for (const id of names.keys()) if (!ids.has(id)) names.delete(id)
    const available = actions.filter(({ actorId }) => names.has(actorId))
    const comparable = JSON.stringify([epoch, available, [...names]])
    if (comparable === lastSnapshot) return
    lastSnapshot = comparable
    const frame = recentActionFrame(available, now)
    publish(
      {
        epoch,
        publishedAt: frame.publishedAt,
        actions: frame.actions.flatMap((action) => {
          const casterName = names.get(action.actorId)
          return casterName ? [{ ...action, casterName }] : []
        }),
      },
      immediate,
    )
  }

  async function readNames() {
    if (readingNames || !active || ctx.signal.aborted) return
    const ids = [...new Set(actions.map(({ actorId }) => actorId))].filter((id) => !queried.has(id))
    if (!ids.length) return
    for (const id of ids) queried.add(id)
    readingNames = true
    const { signal } = generation
    try {
      const { meta, value } = await ctx.game.getCombatants({ ids, fields: ['name'] }, { signal })
      if (signal.aborted || !matchesActivitySource(ctx, current, meta)) return
      for (const entity of value.entities)
        if (entity.name?.state === 'ok' && entity.name.value) names.set(entity.id, entity.name.value)
    } catch {
      // Unavailable identity data leaves those actions out of the snapshot.
    } finally {
      if (!signal.aborted) {
        readingNames = false
        send()
        void readNames()
      }
    }
  }

  function reset() {
    epoch++
    generation.abort()
    generation = new AbortController()
    readingNames = false
    const stale = events
    events = undefined
    stale?.dispose()
    actions = []
    names.clear()
    queried.clear()
  }

  function loseSession() {
    if (!active) return
    current = undefined
    reset()
    send(true)
  }

  function openEvents() {
    const sub = ctx.events.subscribe(['actionEffect'], (batch) => {
      if (events !== sub || !active) return
      for (const { meta, value } of batch.items)
        if (value.type === 'actionEffect' && matchesActivitySource(ctx, current, meta))
          addRecentAction(actions, value.data, meta.observedAt, ctx.clock.now())
      send()
      void readNames()
    })
    events = sub
    void sub.ready.catch(() => {
      if (events === sub) loseSession()
    })
    void sub.closed.then(() => {
      if (events !== sub) return
      sub.dispose()
      openEvents()
    })
  }

  const session = ctx.session.subscribe((batch) => {
    if (!active) return
    for (const next of batch.items) {
      const previous = current
      current = next
      if (previous && sameActivitySource(previous, next)) continue
      reset()
      send(true)
      if (next.state !== 'idle') openEvents()
    }
  })
  void session.ready.catch(loseSession)
  void session.closed.then(loseSession)
  return () => {
    active = false
    session.dispose()
    reset()
  }
}
