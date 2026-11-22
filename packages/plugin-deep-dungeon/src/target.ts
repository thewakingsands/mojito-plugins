import type { CombatantState, PluginContext, Subscription } from '@ffcafe/mojito-plugin-sdk'
import { type Catalog, type Dungeon, dungeonAt } from './data.js'
import { available, type Target, target } from './state.js'

export function watchTarget(ctx: PluginContext, catalog: Catalog, publish: (value: Target | null) => void) {
  let zoneSub: Subscription | null = null,
    targetSub: Subscription | null = null,
    entitySub: Subscription | null = null
  let territory: number | null = null,
    dungeon: Dungeon | null = null,
    id: number | null = null
  let entity: CombatantState | null = null,
    stopped = false
  const update = () => publish(target(catalog, dungeon, id, entity))
  function clearEntity() {
    entitySub?.dispose()
    entitySub = null
    entity = null
    update()
  }
  function clearTarget() {
    targetSub?.dispose()
    targetSub = null
    id = null
    clearEntity()
  }
  function subscribeEntity() {
    if (stopped || id === null || entitySub) return
    const sub = ctx.game.subscribe(
      'entities',
      (batch) => {
        if (stopped || entitySub !== sub) return
        if (!batch.complete) {
          lost()
          return
        }
        for (const { value } of batch.items) {
          entity = value.entities.find((item) => item.id === id) ?? null
          update()
        }
      },
      { ids: [id], fields: ['objectKind', 'subKind', 'name', 'bNpcName', 'hpCur', 'hpMax'] },
    )
    entitySub = sub
    const lost = () => {
      if (entitySub === sub) clearEntity()
    }
    void sub.ready.catch(lost)
    void sub.closed.then(lost)
  }
  function subscribeTarget() {
    if (stopped || !dungeon || targetSub) return
    const sub = ctx.game.subscribe('target', (batch) => {
      if (stopped || targetSub !== sub) return
      if (!batch.complete) {
        lost()
        return
      }
      for (const { value } of batch.items) {
        const next = available(value)
        if (next !== id) {
          id = next
          clearEntity()
        }
        subscribeEntity()
      }
    })
    targetSub = sub
    const lost = () => {
      if (targetSub === sub) clearTarget()
    }
    void sub.ready.catch(lost)
    void sub.closed.then(lost)
  }
  function subscribeZone() {
    if (stopped || zoneSub) return
    const sub = ctx.game.subscribe('zone', (batch) => {
      if (stopped || zoneSub !== sub) return
      if (!batch.complete) {
        lost()
        return
      }
      for (const { value } of batch.items) {
        const next = available(value.territoryType)
        if (next !== territory) {
          territory = next
          dungeon = next === null ? null : dungeonAt(catalog, next)
          clearTarget()
        }
        subscribeTarget()
      }
    })
    zoneSub = sub
    const lost = () => {
      if (zoneSub !== sub) return
      zoneSub.dispose()
      zoneSub = null
      territory = null
      dungeon = null
      clearTarget()
    }
    void sub.ready.catch(lost)
    void sub.closed.then(lost)
  }
  subscribeZone()
  const retry = setInterval(() => {
    subscribeZone()
    subscribeTarget()
    subscribeEntity()
  }, 1000)
  return () => {
    stopped = true
    clearInterval(retry)
    zoneSub?.dispose()
    zoneSub = null
    clearTarget()
  }
}
