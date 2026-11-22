import type { Disposer, PluginContext, Value } from '@ffcafe/mojito-plugin-sdk'
import type { Catalog } from './data.js'
import { names } from './names.js'
import { defaults, language, settings } from './state.js'
import { watchTarget } from './target.js'

export async function activateCatalog(ctx: PluginContext, catalog: Catalog) {
  let config = settings(await ctx.config.get('display')) ?? defaults
  let uiLanguage = (await ctx.session.get()).uiLanguage
  let stopped = false
  const disposers: Disposer[] = []
  const publish = () => ctx.views.set('display', { settings: config, language: language(config, uiLanguage) })
  disposers.push(
    await ctx.views.onCommand('reference', async (input) => {
      if (!input || typeof input !== 'object' || !('ids' in input) || !Array.isArray(input.ids))
        throw new Error('Invalid reference command')
      const ids = input.ids
      if (!ids.every((id) => typeof id === 'number')) throw new Error('Invalid name IDs')
      return names(ctx, ids as number[], catalog.nameColumn)
    }),
  )
  disposers.push(
    await ctx.views.onCommand('display', async (input) => {
      const next = settings(input)
      if (!next) throw new Error('Invalid settings')
      const session = await ctx.session.get()
      await ctx.config.set('display', next)
      if (!stopped) {
        config = next
        uiLanguage = session.uiLanguage
        publish()
      }
      return next
    }),
  )
  disposers.push(
    await ctx.ui.registerOverlay({
      id: 'target',
      name: '选中怪物',
      entry: 'overlay.html',
      defaultSize: { width: 380, height: 280 },
    }),
  )
  disposers.push(
    await ctx.ui.registerFeature({
      id: 'reference',
      name: '深层迷宫图鉴',
      entry: 'reference.html',
      placement: 'sidebar',
    }),
  )
  disposers.push(
    await ctx.ui.registerFeature({
      id: 'settings',
      name: '深层迷宫图鉴',
      entry: 'settings.html',
      placement: 'settings',
    }),
  )
  ctx.views.set('target', null)
  publish()
  disposers.push(
    watchTarget(ctx, catalog, (value) => {
      if (!stopped) ctx.views.set('target', value as unknown as Value)
    }),
  )
  await ctx.views.flush()
  return async () => {
    stopped = true
    for (const dispose of disposers.reverse()) await dispose()
  }
}
