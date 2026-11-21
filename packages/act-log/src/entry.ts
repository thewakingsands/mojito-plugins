import type { PluginContext } from '@ffcafe/mojito-plugin-sdk'
import { Recorder } from './recorder.js'

export async function activate(ctx: PluginContext) {
  const recorder = new Recorder(ctx, (state) => ctx.views.set('recorder', state))
  const command = await ctx.views.onCommand('recorder', async (input) => {
    if (input === 'start') await recorder.start()
    else if (input === 'stop') await recorder.stop()
    else throw new Error('未知的记录命令')
    return null
  })
  const feature = await ctx.ui.registerFeature({ id: 'record', name: 'ACT 日志', entry: 'index.html' })
  ctx.views.set('recorder', recorder.state)
  return async () => {
    await recorder.dispose()
    await feature()
    await command()
  }
}
