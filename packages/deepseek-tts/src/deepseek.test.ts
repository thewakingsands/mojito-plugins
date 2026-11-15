import { type HttpOptions, type HttpService, PluginError } from '@ffcafe/mojito-plugin-sdk'
import { expect, it, vi } from 'vitest'
import { DeepSeekError, ENDPOINT, synthesizeSegment } from './deepseek.js'

const reply = (status: number, body = new Uint8Array([1, 2])) => ({ status, headers: {}, body, url: ENDPOINT })
const http = (result: () => ReturnType<HttpService['request']>) => {
  const request = vi.fn((_url: string, _options?: HttpOptions) => result())
  return { request, service: { request } as HttpService }
}
const call = (service: HttpService, signal = new AbortController().signal) =>
  synthesizeSegment(service, 'sk-test', 'stella', '分摊', signal)

it('posts the segment and returns the body', async () => {
  const { request, service } = http(async () => reply(200))
  const signal = new AbortController().signal
  expect([...(await call(service, signal))]).toEqual([1, 2])
  const [url, options] = request.mock.calls[0]
  expect(url).toBe(ENDPOINT)
  expect(options).toMatchObject({
    method: 'POST',
    headers: { authorization: 'Bearer sk-test', 'content-type': 'application/json' },
    timeoutMs: 15000,
    signal,
  })
  expect(JSON.parse(options!.body as string)).toEqual({
    text: '分摊',
    voice_id: 'stella',
    format: 'pcm',
    filter_markdown: false,
  })
})
it.each([
  [200, '无法连接 DeepSeek 或响应不完整'],
  [400, 'DeepSeek 拒绝了这段文本（没有可朗读的内容、文本过长或未通过内容审核）'],
  [401, 'DeepSeek API Key 无效'],
  [403, 'DeepSeek API Key 无效'],
  [402, 'DeepSeek 账户余额不足'],
  [429, 'DeepSeek 同时进行的请求过多'],
  [503, 'DeepSeek 服务繁忙或合成超时'],
  [504, 'DeepSeek 服务繁忙或合成超时'],
  [418, 'DeepSeek 返回 HTTP 418'],
])('explains status %i', async (status, message) => {
  const { service } = http(async () => reply(status, new Uint8Array()))
  const error = await call(service).catch((error) => error)
  expect(error).toBeInstanceOf(DeepSeekError)
  expect(error).toMatchObject({ message, status })
})
it('reports network errors and passes unavailable through', async () => {
  await expect(call(http(async () => Promise.reject(new Error('reset'))).service)).rejects.toMatchObject({
    message: '无法连接 DeepSeek 或响应不完整',
    status: null,
  })
  const denied = new PluginError({ code: 'unavailable', message: 'denied', retryable: false })
  await expect(call(http(async () => Promise.reject(denied)).service)).rejects.toBe(denied)
})
it('throws the abort reason once aborted', async () => {
  const controller = new AbortController()
  const reason = new Error('stop')
  const { service } = http(async () => {
    controller.abort(reason)
    throw new PluginError({ code: 'cancelled', message: 'cancelled', retryable: false })
  })
  await expect(call(service, controller.signal)).rejects.toBe(reason)
})
