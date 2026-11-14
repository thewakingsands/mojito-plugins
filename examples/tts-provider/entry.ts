import type { PluginContext } from '@ffcafe/mojito-plugin-sdk'
import { toneWav } from './tone.js'

const pitches: Record<string, number> = { low: 440, high: 880 }

/** Offers two beep voices and speaks in its two channels from its page, to try TTS settings end to end */
export async function activate(context: PluginContext) {
  const provider = await context.tts.provide(
    [
      { id: 'low', name: '低音提示音', online: false },
      { id: 'high', name: '高音提示音', online: false },
    ],
    async ({ voice, text }) => {
      const pitch = pitches[voice]
      if (!pitch) throw new Error(`没有音色 ${voice}`)
      return toneWav(text, pitch)
    },
  )
  const command = await context.views.onCommand('say', async (channel) => {
    const alarm = channel === 'alarm'
    await context.tts.say(alarm ? '警报频道测试' : '提示频道测试', alarm ? { channel: 'alarm' } : {})
    return null
  })
  const main = await context.ui.registerFeature({ id: 'main', name: '提示音 TTS 示例', entry: 'main.html' })
  return async () => {
    await Promise.all([command(), main(), provider.dispose()])
  }
}
