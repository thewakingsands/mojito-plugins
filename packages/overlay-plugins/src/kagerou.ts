import type { PluginContext } from '@ffcafe/mojito-plugin-sdk'
import { activateOverlay } from './worker.js'
export const activate = (ctx: PluginContext) =>
  activateOverlay(ctx, {
    id: 'kagerou',
    name: 'Kagerou',
    protocol: 'legacy-dom',
    entry: 'overlay/index.html',
    documents: ['overlay/index.html', 'config/index.html'],
  })
