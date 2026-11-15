import type { HttpOptions, Json, PluginContext, Value, ViewIdentity } from '@ffcafe/mojito-plugin-sdk'
import { expect, it, vi } from 'vitest'
import { ENDPOINT } from './deepseek.js'
import { activate } from './entry.js'
import { VOICES } from './synthesize.js'

type Synthesize = Parameters<PluginContext['tts']['provide']>[1]

async function harness(saved: Record<string, Json> = {}) {
  const config = new Map<string, Json>(Object.entries(saved))
  let command!: (input: Value, view: ViewIdentity) => Value | Promise<Value>
  let synthesize: Synthesize | null = null
  const provider = { update: vi.fn(), dispose: vi.fn(async () => {}) }
  const released = { command: vi.fn(), feature: vi.fn() }
  let status = 200
  const request = vi.fn(async (_url: string, _options?: HttpOptions) => ({
    status,
    headers: {},
    body: status === 200 ? new Uint8Array([1, 2]) : new Uint8Array(),
    url: ENDPOINT,
  }))
  const ctx = {
    capabilities: { get: () => ({ 'http.request': { state: 'available' } }) },
    config: {
      get: vi.fn(async (key: string) => config.get(key) ?? null),
      set: vi.fn(async (key: string, value: Json) => {
        config.set(key, value)
      }),
    },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    http: { request },
    notifications: { send: vi.fn(async () => {}) },
    tts: {
      provide: vi.fn(async (_voices, callback: Synthesize) => {
        synthesize = callback
        return provider
      }),
    },
    views: {
      onCommand: async (_channel: string, handler: typeof command) => {
        command = handler
        return released.command
      },
    },
    ui: { registerFeature: vi.fn(async () => released.feature), setPreferenceItems: vi.fn(async () => {}) },
  } as unknown as PluginContext
  const dispose = await activate(ctx)
  return {
    ctx,
    config,
    provider,
    released,
    dispose,
    fail: (next: number) => {
      status = next
    },
    command: (value: Value) => command(value, { placement: 'settings' } as ViewIdentity),
    speak: (text: string) => synthesize!({ voice: 'stella', text }, { signal: new AbortController().signal }),
  }
}

it('registers the voices only while a key is saved', async () => {
  const h = await harness()
  expect(h.ctx.tts.provide).not.toHaveBeenCalled()
  expect(await h.command({ type: 'getSettings' })).toEqual({ hasKey: false, usage: null })
  await h.command({ type: 'setApiKey', value: ' sk-1 ' })
  expect(h.ctx.tts.provide).toHaveBeenCalledTimes(1)
  expect(vi.mocked(h.ctx.tts.provide).mock.calls[0][0]).toEqual(VOICES)
  expect(h.config.get('apiKey')).toBe('sk-1')
  await h.command({ type: 'setApiKey', value: '' })
  expect(h.provider.dispose).toHaveBeenCalledTimes(1)
  await h.command({ type: 'setApiKey', value: 'sk-2' })
  expect(h.ctx.tts.provide).toHaveBeenCalledTimes(2)
})
it('never returns the key to the page', async () => {
  const h = await harness({ apiKey: 'sk-secret-ab12' })
  expect(h.ctx.tts.provide).toHaveBeenCalledTimes(1)
  expect(JSON.stringify(await h.command({ type: 'getSettings' }))).not.toContain('sk-secret')
})
it('notifies once per key on 401', async () => {
  const h = await harness({ apiKey: 'sk-1' })
  h.fail(401)
  await expect(h.speak('分摊')).rejects.toThrow('DeepSeek API Key 无效')
  await expect(h.speak('分摊')).rejects.toThrow('DeepSeek API Key 无效')
  expect(h.ctx.notifications.send).toHaveBeenCalledTimes(1)
  await h.command({ type: 'setApiKey', value: 'sk-2' })
  await expect(h.speak('分摊')).rejects.toThrow('DeepSeek API Key 无效')
  expect(h.ctx.notifications.send).toHaveBeenCalledTimes(2)
})
it('records the usage of every successful request', async () => {
  const h = await harness({ apiKey: 'sk-1', usage: { chars: 10, since: '2026-11-01' } })
  await h.speak('分摊')
  await h.speak('分摊')
  await vi.waitFor(() => expect(h.config.get('usage')).toEqual({ chars: 18, since: '2026-11-01' }))
  expect(await h.command({ type: 'getSettings' })).toEqual({
    hasKey: true,
    usage: { chars: 18, since: '2026-11-01' },
  })
})
it('releases everything on dispose', async () => {
  const h = await harness({ apiKey: 'sk-1' })
  await h.dispose()
  expect(h.released.command).toHaveBeenCalled()
  expect(h.released.feature).toHaveBeenCalled()
  expect(h.provider.dispose).toHaveBeenCalled()
})
