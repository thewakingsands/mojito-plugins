import type { PluginContext, Value } from '@ffcafe/mojito-plugin-sdk'
import { pluginError } from '@ffcafe/mojito-plugin-sdk/errors'
import { type EndEncounterResult, type OverlayState, overlayState } from '@ffcafe/mojito-plugin-sdk/overlayplugin'
import { fields, object, text } from '@ffcafe/mojito-plugin-sdk/schema'

/** Others use it as ffcafe.combat-statistics/overlay */
export const overlayService = { name: 'overlay', version: '1.0.0' }
export async function provideOverlayService(
  ctx: PluginContext,
  enqueue: <T>(task: () => T | Promise<T>) => Promise<T>,
  endEncounter: (id: string) => Promise<EndEncounterResult>,
) {
  let latest: { revision: number; state: OverlayState; identityAllowed: boolean } | null = null
  const payload = ({ revision, state, identityAllowed }: NonNullable<typeof latest>) => {
    if (identityAllowed && ctx.capabilities.get()['identity.read']?.state !== 'available') {
      const hidden = { state: 'unavailable' as const, reason: '角色身份权限已变更' }
      state = {
        ...state,
        combatData: null,
        primaryPlayer: null,
        availability: { ...state.availability, combatData: hidden, primaryPlayer: hidden },
      }
    }
    return { revision, state } as unknown as Value
  }
  let stopped = false
  const dispose = await ctx.services.provide(overlayService, (request) =>
    enqueue(async () => {
      if (stopped) throw pluginError('plugin_stopped')
      if (request.method === 'getState') {
        if (request.payload !== null) throw pluginError('invalid_argument')
        if (!latest) throw pluginError('unavailable')
        return structuredClone(payload(latest))
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
    async publish(
      state: OverlayState,
      identityAllowed = ctx.capabilities.get()['identity.read']?.state === 'available',
    ) {
      if (stopped) throw pluginError('plugin_stopped')
      latest = { revision: (latest?.revision ?? 0) + 1, state: overlayState(state), identityAllowed }
      await ctx.services.publish(overlayService.name, 'state', payload(latest))
    },
    async dispose() {
      stopped = true
      latest = null
      await dispose()
    },
  }
}
