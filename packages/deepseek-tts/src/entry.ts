import type { Disposer, PluginContext, Value, VoiceProvider } from '@ffcafe/mojito-plugin-sdk'
import { createSynthesizer, VOICES } from './synthesize.js'

export interface Usage {
  chars: number
  /** 第一次记账的本地日期，YYYY-MM-DD */
  since: string
}

function usageOf(value: unknown): Usage | null {
  if (!value || typeof value !== 'object') return null
  const { chars, since } = value as Partial<Usage>
  return typeof chars === 'number' && Number.isFinite(chars) && chars >= 0 && typeof since === 'string'
    ? { chars, since }
    : null
}
function today() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export async function activate(ctx: PluginContext) {
  const saved = await ctx.config.get('apiKey')
  let apiKey = typeof saved === 'string' && saved ? saved : null
  let usage = usageOf(await ctx.config.get('usage'))
  let stopped = false

  let saving = Promise.resolve()
  function record(chars: number) {
    usage = { chars: (usage?.chars ?? 0) + chars, since: usage?.since ?? today() }
    saving = saving
      .then(() => ctx.config.set('usage', { ...usage! }))
      .catch((error) => ctx.log.warn('费用统计保存失败', { error: String(error) }))
  }
  let notifiedKey: string | null = null
  function unauthorized() {
    if (!apiKey || apiKey === notifiedKey) return
    notifiedKey = apiKey
    ctx.notifications
      .send({ title: 'DeepSeek API Key 无效', detail: '请在 DeepSeek 语音的设置页中重新填写 API Key。' })
      .catch((error) => ctx.log.warn('通知发送失败', { error: String(error) }))
  }
  const synthesize = createSynthesizer({
    http: ctx.http,
    apiKey: () => apiKey,
    httpDenied: () => ctx.capabilities.get()['http.request']?.state === 'denied',
    record,
    unauthorized,
    log: ctx.log,
  })
  let provider: VoiceProvider | null = null
  if (apiKey) provider = await ctx.tts.provide(VOICES, synthesize)

  let keyChange = Promise.resolve()
  async function setApiKey(value: string) {
    const next = value.trim() || null
    await ctx.config.set('apiKey', next ?? '')
    apiKey = next
    if (stopped) return
    if (next && !provider) provider = await ctx.tts.provide(VOICES, synthesize)
    else if (!next && provider) {
      await provider.dispose()
      provider = null
    }
  }
  const disposers: Disposer[] = []
  disposers.push(
    await ctx.views.onCommand('settings', async (input): Promise<Value> => {
      if (!input || typeof input !== 'object' || Array.isArray(input) || input instanceof Uint8Array)
        throw new Error('Invalid command')
      switch (input.type) {
        case 'getSettings':
          return { hasKey: apiKey !== null, usage: usage ? { ...usage } : null }
        case 'setApiKey': {
          const value = input.value
          if (typeof value !== 'string') throw new Error('Invalid command')
          const change = keyChange.then(() => setApiKey(value))
          keyChange = change.catch(() => {})
          await change
          return null
        }
      }
      throw new Error('Invalid command')
    }),
  )
  disposers.push(
    await ctx.ui.registerFeature({
      id: 'settings',
      name: 'DeepSeek 语音',
      entry: 'settings.html',
      placement: 'settings',
    }),
  )
  await ctx.ui
    .setPreferenceItems([
      {
        id: 'api-key',
        title: 'API Key',
        description: '填写 DeepSeek API Key 后，海星、暗潮两个音色出现在 TTS 设置中。',
      },
      { id: 'usage', title: '累计费用', description: '按 DeepSeek 刊例价估算的语音合成费用。' },
    ])
    .catch((error) => ctx.log.warn('设置搜索项提交失败', { error: String(error) }))

  return async () => {
    stopped = true
    for (const dispose of disposers.reverse()) await dispose()
    await provider?.dispose()
    provider = null
  }
}
