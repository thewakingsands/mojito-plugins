import type { Disposer, PluginContext, Subscription, Value } from '@ffcafe/mojito-plugin-sdk'
import { pluginError } from '@ffcafe/mojito-plugin-sdk/errors'
import { type OverlayCompatibility, overlayProducer, overlayState } from '@ffcafe/mojito-plugin-sdk/overlayplugin'
import { fields, object } from '@ffcafe/mojito-plugin-sdk/schema'

const service = 'combat.statistics.overlay'
export async function activateOverlay(
  ctx: PluginContext,
  definition: {
    id: string
    name: string
    protocol: OverlayCompatibility['protocol']
    entry: string
    documents: string[]
  },
) {
  let live = true,
    revision = 0,
    queue = Promise.resolve()
  let subscription: Subscription | undefined
  const disposers: Disposer[] = []
  const producer = overlayProducer(ctx.views, 'combat')
  let stopping: Promise<void> | undefined
  const stop = () => {
    if (stopping) return stopping
    live = false
    stopping = Promise.resolve().then(async () => {
      subscription?.dispose()
      for (const dispose of disposers.reverse()) await dispose()
      await queue
      if (!ctx.signal.aborted) {
        ctx.views.set('combat', null)
        await ctx.views.flush()
      }
    })
    return stopping
  }
  const receive = (input: Value) => {
    const next = queue.then(async () => {
      if (!live || ctx.signal.aborted) return
      const value = object(input)
      fields(value, ['revision', 'state'])
      if (!Number.isSafeInteger(value.revision) || Number(value.revision) <= 0) throw pluginError('invalid_argument')
      const state = overlayState(value.state)
      if (Number(value.revision) <= revision) return
      await producer.publish(state)
      revision = Number(value.revision)
    })
    queue = next.catch(() => {})
    return next
  }
  try {
    const provider = (await ctx.services.connect(service, '^1.0.0')).find(
      (item) => item.pluginId === 'CombatStatistics',
    )
    if (!provider) throw pluginError('unavailable', '请先安装、启用战斗统计并授权服务')
    subscription = ctx.services.subscribe(
      { providerId: provider.pluginId, name: service, event: 'state' },
      async (batch) => {
        if (!batch.complete) throw pluginError('source_incomplete')
        for (const value of batch.items) await receive(value)
      },
    )
    void subscription.closed
      .then(async ({ reason }) => {
        if (!live) return
        await stop()
        if (!ctx.signal.aborted) ctx.log.warn('战斗统计服务不可用，请修复依赖后重新启用', { reason })
      })
      .catch(() => {})
    await subscription.ready
    await receive(await ctx.services.request(provider.pluginId, service, 'getState', null))
    if (!live || ctx.signal.aborted) throw pluginError('cancelled')
    disposers.push(
      await producer.onEnd(async (encounterId) => {
        if (!live) throw pluginError('unavailable')
        const result = object(await ctx.services.request(provider.pluginId, service, 'endEncounter', { encounterId }))
        fields(result, ['result'])
        if (!['ended', 'alreadyEnded', 'staleEncounter', 'notFound'].includes(String(result.result)))
          throw pluginError('invalid_argument')
        return result.result as 'ended' | 'alreadyEnded' | 'staleEncounter' | 'notFound'
      }),
    )
    disposers.push(
      await ctx.ui.registerOverlay({
        id: definition.id,
        name: definition.name,
        defaultSize: { width: 600, height: 400 },
        compatibility: {
          kind: 'overlayplugin',
          protocol: definition.protocol,
          channel: 'combat',
          source: {
            kind: 'package',
            entry: definition.entry,
            documents: definition.documents,
          },
        },
      }),
    )
    return stop
  } catch (error) {
    await stop()
    throw error
  }
}
