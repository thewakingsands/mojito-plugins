import type { PluginContext, Value } from '@ffcafe/mojito-plugin-sdk'
import { pluginError } from '@ffcafe/mojito-plugin-sdk/errors'
import { type EndEncounterResult, type OverlayState, overlayState } from '@ffcafe/mojito-plugin-sdk/overlayplugin'
import { fields, object, text } from '@ffcafe/mojito-plugin-sdk/schema'

export const overlayService = {
  name: 'combat.statistics.overlay',
  version: '1.0.0',
  dataPermissions: ['session.read', 'game.read', 'events.read', 'data.read'],
}
export async function provideOverlayService(
  ctx: PluginContext,
  enqueue: <T>(task: () => T | Promise<T>) => Promise<T>,
  endEncounter: (id: string) => Promise<EndEncounterResult>,
) {
  let latest: { revision: number; state: OverlayState } | null = null
  let stopped = false
  const dispose = await ctx.services.provide(overlayService, (request) =>
    enqueue(async () => {
      if (stopped) throw pluginError('plugin_stopped')
      if (request.method === 'getState') {
        if (request.payload !== null) throw pluginError('invalid_argument')
        if (!latest) throw pluginError('unavailable')
        return structuredClone(latest) as unknown as Value
      }
      if (request.method === 'endEncounter') {
        const value = object(request.payload)
        fields(value, ['encounterId'])
        return { result: await endEncounter(text(value.encounterId)) }
      }
      throw pluginError('invalid_argument')
    }),
  )
  return {
    async publish(state: OverlayState) {
      if (stopped) throw pluginError('plugin_stopped')
      latest = { revision: (latest?.revision ?? 0) + 1, state: overlayState(state) }
      await ctx.services.publish(overlayService.name, 'state', latest as unknown as Value)
    },
    async dispose() {
      stopped = true
      latest = null
      await dispose()
    },
  }
}
