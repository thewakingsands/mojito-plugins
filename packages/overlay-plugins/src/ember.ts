import type { PluginContext } from '@ffcafe/mojito-plugin-sdk'
import { registerGameIcons } from './icons.js'
import { activateOverlay } from './worker.js'
export async function activate(ctx: PluginContext) {
  const removeIcons = await registerGameIcons(ctx)
  try {
    const stop = await activateOverlay(ctx, {
      id: 'ember',
      name: 'Ember',
      protocol: 'modern',
      entry: 'index.html',
      documents: ['index.html'],
    })
    return async () => {
      await removeIcons()
      await stop()
    }
  } catch (error) {
    await removeIcons()
    throw error
  }
}
