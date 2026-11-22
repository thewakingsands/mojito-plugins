import type { Disposer, PluginContext, Value } from '@ffcafe/mojito-plugin-sdk'
import { observeGlassActivity } from './glass-activity.js'
import { registerSay } from './say.js'
import { activateOverlay } from './worker.js'

export async function activate(ctx: PluginContext) {
  const removeSound = await ctx.views.onCommand('combat/playSound', async (input): Promise<Value> => {
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      input instanceof Uint8Array ||
      typeof input.file !== 'string'
    )
      return { error: 'invalid_argument' }
    await ctx.audio.play({ path: input.file })
    return {}
  })
  let removeSay: Disposer | undefined
  try {
    removeSay = await registerSay(ctx, 'combat')
    const stop = await activateOverlay(
      ctx,
      {
        id: 'glass',
        name: 'Glass',
        protocol: 'modern',
        entry: 'index.html',
        documents: ['index.html', 'settings.html'],
      },
      (publish) => observeGlassActivity(ctx, publish),
    )
    return async () => {
      await removeSay?.()
      await removeSound()
      await stop()
    }
  } catch (error) {
    await removeSay?.()
    await removeSound()
    throw error
  }
}
