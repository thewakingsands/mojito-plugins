import type { PluginContext } from '@ffcafe/mojito-plugin-sdk'
import { activateOverlay } from './worker.js'
export const activate = (ctx: PluginContext) =>
  activateOverlay(ctx, {
    id: 'mopimopi1',
    name: 'MopiMopi v1',
    protocol: 'modern',
    entry: 'index.html',
    documents: ['index.html'],
  })
