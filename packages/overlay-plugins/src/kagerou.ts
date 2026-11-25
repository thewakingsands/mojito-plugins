import type { PluginContext } from '@ffcafe/mojito-plugin-sdk'
import { activateOverlayWithIcons } from './icons.js'
export const activate = (ctx: PluginContext) =>
  activateOverlayWithIcons(ctx, {
    id: 'kagerou',
    name: 'Kagerou',
    protocol: 'legacy-dom',
    entry: 'overlay/index.html',
    documents: ['overlay/index.html', 'config/index.html'],
  })
