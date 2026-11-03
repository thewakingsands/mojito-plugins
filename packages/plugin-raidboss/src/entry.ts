import type { PluginContext } from '@ffcafe/mojito-plugin-sdk'
import { activateRaidboss } from '@ffcafe/mojito-raidboss'

const modules = import.meta.glob('../../raidboss/vendor/cactbot/ui/raidboss/data/**/*.ts', {
  eager: true,
  import: 'default',
})
const raw = import.meta.glob('../../raidboss/vendor/cactbot/ui/raidboss/data/**/*.txt', {
  eager: true,
  query: '?raw',
  import: 'default',
})
const timelines = Object.fromEntries(
  Object.entries(raw).map(([path, text]) => [path.split('/').at(-1)!, text as string]),
)
const sets = Object.entries(modules)
  .filter(([path]) => !path.includes('/test/') && !path.endsWith('/test.ts'))
  .map(([path, set]) => ({ path, set }))
export const activate = (ctx: PluginContext) =>
  activateRaidboss(ctx, sets, timelines, 'e79ea7f16093be5b80cda0e2d5bc8eb899d6fb4b')
