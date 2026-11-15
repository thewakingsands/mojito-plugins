import { type HttpService, type LogService, PluginError } from '@ffcafe/mojito-plugin-sdk'
import { billedChars } from './billing.js'
import { DeepSeekError, NETWORK_FAILED, synthesizeSegment } from './deepseek.js'
import { wav } from './wav.js'

export const VOICES = [
  { id: 'stella', name: 'DeepSeek 海星（女声）', online: true },
  { id: 'tide', name: 'DeepSeek 暗潮（男声）', online: true },
]

const readable = /[\p{L}\p{N}]/u

export interface SynthesizerDeps {
  http: HttpService
  apiKey(): string | null
  httpDenied(): boolean
  /** 累加一次成功请求的计费字符数 */
  record(chars: number): void
  /** 收到 401/403 时调用 */
  unauthorized(): void
  log: LogService
}

export function createSynthesizer(deps: SynthesizerDeps) {
  return async ({ voice, text }: { voice: string; text: string }, { signal }: { signal: AbortSignal }) => {
    if (!VOICES.some((item) => item.id === voice)) throw new Error('没有这个音色')
    const content = text.trim()
    // DeepSeek 对没有可朗读内容的文本返回 400，在本地直接拒绝。
    if (!readable.test(content)) throw new Error('没有可朗读的文本')
    const apiKey = deps.apiKey()
    if (!apiKey) throw new Error('未填写 DeepSeek API Key')
    let pcm: Uint8Array
    try {
      pcm = await synthesizeSegment(deps.http, apiKey, voice, content, signal)
    } catch (error) {
      if (signal.aborted) throw error
      deps.log.warn('DeepSeek 合成失败', {
        status: error instanceof DeepSeekError ? error.status : null,
        length: content.length,
      })
      if (error instanceof DeepSeekError && (error.status === 401 || error.status === 403)) deps.unauthorized()
      if (error instanceof PluginError && error.code === 'unavailable')
        throw deps.httpDenied()
          ? new Error('未授予网络权限，请在插件页面中允许网络请求')
          : new DeepSeekError(NETWORK_FAILED, null)
      throw error
    }
    deps.record(billedChars(content))
    return wav([pcm])
  }
}
