import type { PluginContext } from '@ffcafe/mojito-plugin-sdk'
import { activateOverlayWithIcons } from './icons.js'
export const activate = (ctx: PluginContext) =>
  activateOverlayWithIcons(ctx, {
    id: 'glass',
    name: 'Glass',
    protocol: 'modern',
    entry: 'index.html',
    documents: ['index.html', 'settings.html'],
  })
