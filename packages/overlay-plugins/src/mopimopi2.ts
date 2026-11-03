import type { PluginContext } from '@ffcafe/mojito-plugin-sdk'
import { activateOverlay } from './worker.js'
export const activate = (ctx: PluginContext) =>
  activateOverlay(ctx, {
    id: 'mopimopi2',
    name: 'MopiMopi2',
    protocol: 'actws',
    entry: 'index.html',
    documents: ['index.html'],
  })
