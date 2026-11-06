import type { PluginContext } from '@ffcafe/mojito-plugin-sdk'
import { activateOverlay } from './worker.js'
export const activate = (ctx: PluginContext) =>
  activateOverlay(ctx, {
    id: 'faceroll',
    name: 'faceroll',
    protocol: 'modern',
    entry: 'index.html',
    documents: ['index.html'],
  })
