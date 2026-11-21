import type { Disposer, Json, PluginContext, Subscription, Value } from '@ffcafe/mojito-plugin-sdk'
import { pluginError } from '@ffcafe/mojito-plugin-sdk/errors'
import {
  type OverlayCompatibility,
  type OverlayState,
  overlayProducer,
  overlayState,
} from '@ffcafe/mojito-plugin-sdk/overlayplugin'
import { fields, object } from '@ffcafe/mojito-plugin-sdk/schema'

const service = 'ffcafe.combat-statistics/overlay'
export async function activateOverlay(
  ctx: PluginContext,
  definition: {
    id: string
    name: string
    protocol: OverlayCompatibility['protocol']
    entry: string
    documents: string[]
  },
  activity?: (publish: (custom: Json, immediate?: boolean) => void) => Disposer,
) {
  let live = true,
    revision = 0,
    queue = Promise.resolve()
  let subscription: Subscription | undefined
  let current: OverlayState | undefined, custom: Json | undefined
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
      const { custom: _providerCustom, ...state } = overlayState(value.state)
      if (Number(value.revision) <= revision) return
      current = state
      await producer.publish(custom === undefined ? state : { ...state, custom })
      revision = Number(value.revision)
    })
    queue = next.catch(() => {})
    return next
  }
  try {
    if (!(await ctx.services.connect(service, '^1.0.0'))) throw pluginError('unavailable', '请先安装并启用战斗统计')
    subscription = ctx.services.subscribe({ service, event: 'state' }, async (batch) => {
      if (!batch.complete) throw pluginError('source_incomplete')
      for (const value of batch.items) await receive(value)
    })
    void subscription.closed
      .then(async ({ reason }) => {
        if (!live) return
        await stop()
        if (!ctx.signal.aborted) ctx.log.warn('战斗统计服务不可用，请修复依赖后重新启用', { reason })
      })
      .catch(() => {})
    await subscription.ready
    await receive(await ctx.services.request(service, 'getState', null))
    if (!live || ctx.signal.aborted) throw pluginError('cancelled')
    if (activity)
      disposers.push(
        activity((value, immediate) => {
          queue = queue
            .then(async () => {
              if (!live || ctx.signal.aborted || !current) return
              custom = value
              await producer.publish({ ...current, custom })
              if (immediate) await ctx.views.flush()
            })
            .catch((error) => ctx.log.warn('悬浮窗活动更新失败', { error: String(error) }))
        }),
      )
    disposers.push(
      await producer.onEnd(async (encounterId) => {
        if (!live) throw pluginError('unavailable')
        const result = object(await ctx.services.request(service, 'endEncounter', { encounterId }))
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
