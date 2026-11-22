import catalog from 'deep-dungeon:catalog'
import type { PluginContext } from '@ffcafe/mojito-plugin-sdk'
import { activateCatalog } from './worker.js'

export const activate = (ctx: PluginContext) => activateCatalog(ctx, catalog)
