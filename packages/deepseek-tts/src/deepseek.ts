import { type HttpService, PluginError } from '@ffcafe/mojito-plugin-sdk'

export const ENDPOINT = 'https://api.deepseek.com/v1/tools/tts'
export const NETWORK_FAILED = '无法连接 DeepSeek 或响应不完整'

export class DeepSeekError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message)
    this.name = 'DeepSeekError'
  }
}

function statusMessage(status: number) {
  switch (status) {
    case 400:
      return 'DeepSeek 拒绝了这段文本（没有可朗读的内容、文本过长或未通过内容审核）'
    case 401:
    case 403:
      return 'DeepSeek API Key 无效'
    case 402:
      return 'DeepSeek 账户余额不足'
    case 429:
      return 'DeepSeek 同时进行的请求过多'
    case 503:
    case 504:
      return 'DeepSeek 服务繁忙或合成超时'
    default:
      return `DeepSeek 返回 HTTP ${status}`
  }
}

/**
 * 整段合成一个片段，返回 24 kHz、16 位、单声道的 PCM。
 * 宿主以 `unavailable` 拒绝时原样抛出，由调用方结合权限状态给出说明。
 */
export async function synthesizeSegment(
  http: HttpService,
  apiKey: string,
  voice: string,
  text: string,
  signal: AbortSignal,
): Promise<Uint8Array> {
  let response: Awaited<ReturnType<HttpService['request']>>
  try {
    response = await http.request(ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text, voice_id: voice, format: 'pcm', filter_markdown: false }),
      timeoutMs: 15000,
      signal,
    })
  } catch (error) {
    if (signal.aborted) throw signal.reason
    if (error instanceof PluginError && error.code === 'unavailable') throw error
    throw new DeepSeekError(NETWORK_FAILED, null)
  }
  if (signal.aborted) throw signal.reason
  if (response.status !== 200) throw new DeepSeekError(statusMessage(response.status), response.status)
  if (!response.body.length) throw new DeepSeekError(NETWORK_FAILED, 200)
  return response.body
}
