import type { PluginContext } from '@ffcafe/mojito-plugin-sdk'
import { activateOverlayWithIcons } from './icons.js'
export const activate = (ctx: PluginContext) =>
  activateOverlayWithIcons(ctx, {
    id: 'cmskin',
    name: 'CMSkin',
    protocol: 'modern',
    entry: 'index.html',
    documents: ['index.html'],
  })
