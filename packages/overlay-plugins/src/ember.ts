import type { PluginContext } from '@ffcafe/mojito-plugin-sdk'
import { observeActivity } from './activity.js'
import { registerCombatants } from './combatants.js'
import { registerGameIcons } from './icons.js'
import { registerSay } from './say.js'
import { activateOverlay } from './worker.js'
export async function activate(ctx: PluginContext) {
  const removeIcons = await registerGameIcons(ctx)
  let removeCombatants: (() => Promise<void> | void) | undefined
  let removeSay: (() => Promise<void> | void) | undefined
  try {
    removeCombatants = await registerCombatants(ctx, 'combat')
    removeSay = await registerSay(ctx, 'combat')
    const stop = await activateOverlay(
      ctx,
      {
        id: 'ember',
        name: 'Ember',
        protocol: 'modern',
        entry: 'index.html',
        documents: ['index.html'],
      },
      (publish) => observeActivity(ctx, publish),
    )
    return async () => {
      await removeSay?.()
      await removeCombatants?.()
      await removeIcons()
      await stop()
    }
  } catch (error) {
    await removeSay?.()
    await removeCombatants?.()
    await removeIcons()
    throw error
  }
}
