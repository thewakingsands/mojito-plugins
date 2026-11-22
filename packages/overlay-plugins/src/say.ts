import { type PluginContext, PluginError, type Value } from '@ffcafe/mojito-plugin-sdk'

export async function registerSay(ctx: PluginContext, channel: string) {
  return ctx.views.onCommand(`${channel}/say`, (input): Value => {
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      input instanceof Uint8Array ||
      typeof input.text !== 'string'
    )
      return { error: 'invalid_argument' }
    void ctx.tts.say(input.text).catch((error: unknown) => {
      if (error instanceof PluginError && (error.code === 'cancelled' || error.code === 'unavailable')) return
      ctx.log.warn('Overlay speech failed', { error: String(error) })
    })
    return {}
  })
}
