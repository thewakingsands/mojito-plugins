import type { PluginContext } from '@ffcafe/mojito-plugin-sdk'

export async function activate(context: PluginContext) {
  let count = 0
  context.views.set('counter', { count })
  const command = await context.views.onCommand('increment', async () => {
    count++
    context.views.set('counter', { count })
    // The pages show the new count by the time the command returns.
    await context.views.flush()
    return count
  })
  const main = await context.ui.registerFeature({ id: 'main', name: 'Counter', entry: 'main.html' })
  const details = await context.ui.registerFeature({ id: 'details', name: 'Counter details', entry: 'details.html' })
  const home = await context.ui.registerFeature({
    id: 'home',
    name: 'Example home',
    entry: 'home.html',
    placement: 'home',
  })
  const settings = await context.ui.registerFeature({
    id: 'settings',
    name: 'Example settings',
    entry: 'settings.html',
    placement: 'settings',
  })
  // The host's settings search and Ctrl K find these; settings.html highlights the one the user chose
  await context.ui.setPreferenceItems([
    { id: 'scope', title: '统计范围', description: '悬浮窗和记录里计入哪些人。' },
    { id: 'hide', title: '战斗外隐藏悬浮窗', description: '脱战 10 秒后淡出。' },
    { id: 'split', title: '分段间隔', description: '单位秒，0 表示整场不分段。' },
  ])
  const overlay = await context.ui.registerOverlay({
    id: 'counter',
    name: 'Counter overlay',
    entry: 'overlay.html',
    defaultSize: { width: 320, height: 180 },
  })
  return async () => {
    await Promise.all([command(), main(), details(), home(), settings(), overlay()])
  }
}
