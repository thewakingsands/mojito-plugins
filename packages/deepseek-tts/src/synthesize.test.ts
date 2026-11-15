import { type HttpOptions, PluginError } from '@ffcafe/mojito-plugin-sdk'
import { expect, it, vi } from 'vitest'
import { ENDPOINT } from './deepseek.js'
import { createSynthesizer, type SynthesizerDeps } from './synthesize.js'

const sent = (options?: HttpOptions) => JSON.parse(options!.body as string).text as string
const log = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })

function harness(patch: Partial<SynthesizerDeps> = {}) {
  const request = vi.fn(async (_url: string, options?: HttpOptions) => ({
    status: 200,
    headers: {},
    body: new TextEncoder().encode(sent(options)),
    url: ENDPOINT,
  }))
  const deps: SynthesizerDeps = {
    http: { request },
    apiKey: () => 'sk-test',
    httpDenied: () => false,
    record: vi.fn(),
    unauthorized: vi.fn(),
    log: log(),
    ...patch,
  }
  return { deps, request, synthesize: createSynthesizer(deps) }
}
const signal = () => new AbortController().signal

it('synthesizes the whole text as one WAV and records its billed characters', async () => {
  const h = harness()
  const audio = await h.synthesize({ voice: 'stella', text: ' Alice 和小明分摊 ' }, { signal: signal() })
  expect(h.request).toHaveBeenCalledTimes(1)
  expect(new TextDecoder().decode(audio.subarray(44))).toBe('Alice 和小明分摊')
  expect(h.deps.record).toHaveBeenCalledWith(16)
})
it.each([
  [{ voice: 'other', text: '分摊' }, {}, '没有这个音色'],
  [{ voice: 'stella', text: '，' }, {}, '没有可朗读的文本'],
  [{ voice: 'stella', text: '分摊' }, { apiKey: () => null }, '未填写 DeepSeek API Key'],
])('rejects %j without a request', async (input, patch, message) => {
  const h = harness(patch)
  await expect(h.synthesize(input, { signal: signal() })).rejects.toThrow(message)
  expect(h.request).not.toHaveBeenCalled()
})
it('reports 401 and records nothing', async () => {
  const h = harness()
  h.request.mockResolvedValue({ status: 401, headers: {}, body: new Uint8Array(), url: ENDPOINT })
  await expect(h.synthesize({ voice: 'stella', text: '分摊' }, { signal: signal() })).rejects.toThrow(
    'DeepSeek API Key 无效',
  )
  expect(h.deps.unauthorized).toHaveBeenCalledTimes(1)
  expect(h.deps.record).not.toHaveBeenCalled()
})
it('explains a denied network capability', async () => {
  const h = harness({ httpDenied: () => true })
  h.request.mockRejectedValue(new PluginError({ code: 'unavailable', message: 'denied', retryable: false }))
  await expect(h.synthesize({ voice: 'tide', text: '分摊' }, { signal: signal() })).rejects.toThrow(
    '未授予网络权限，请在插件页面中允许网络请求',
  )
})
it('throws the abort reason when the caller aborts', async () => {
  const h = harness()
  h.request.mockImplementation(
    (_url, options) =>
      new Promise((_, reject) => {
        options!.signal!.addEventListener('abort', () =>
          reject(new PluginError({ code: 'cancelled', message: 'cancelled', retryable: false })),
        )
      }),
  )
  const controller = new AbortController()
  const pending = h.synthesize({ voice: 'stella', text: '分摊' }, { signal: controller.signal })
  await vi.waitFor(() => expect(h.request).toHaveBeenCalled())
  const reason = new Error('stop')
  controller.abort(reason)
  await expect(pending).rejects.toBe(reason)
  expect(h.deps.record).not.toHaveBeenCalled()
  expect(h.deps.log.warn).not.toHaveBeenCalled()
})
