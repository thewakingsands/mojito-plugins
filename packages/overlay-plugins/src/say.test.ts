import { type PluginContext, PluginError, type Value } from '@ffcafe/mojito-plugin-sdk'
import { expect, it, vi } from 'vitest'
import { registerSay } from './say.js'

async function fixture() {
  let command!: (input: Value) => Value
  const say = vi.fn<PluginContext['tts']['say']>()
  const warn = vi.fn()
  const dispose = vi.fn()
  const onCommand = vi.fn(async (_channel: string, handler: typeof command) => {
    command = handler
    return dispose
  })
  const ctx = { tts: { say }, log: { warn }, views: { onCommand } } as unknown as PluginContext
  const stop = await registerSay(ctx, 'combat')
  return { command, dispose, onCommand, say, stop, warn }
}

it('acknowledges speech before it finishes, forwarding the original Ember text', async () => {
  const f = await fixture()
  let finish!: () => void
  f.say.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve
    }),
  )
  expect(f.onCommand).toHaveBeenCalledWith('combat/say', expect.any(Function))
  expect(f.command({ text: '魔力不足', key: 'text', data: '魔力不足' })).toEqual({})
  expect(f.say).toHaveBeenCalledWith('魔力不足')
  finish()
  await f.stop()
  expect(f.dispose).toHaveBeenCalledOnce()
})

it('ignores normal speech rejections and reports unexpected ones', async () => {
  const f = await fixture()
  for (const code of ['cancelled', 'unavailable'] as const) {
    f.say.mockRejectedValueOnce(new PluginError({ code, message: code, retryable: false }))
    expect(f.command({ text: 'Low MP' })).toEqual({})
  }
  await Promise.resolve()
  expect(f.warn).not.toHaveBeenCalled()
  f.say.mockRejectedValueOnce(new Error('Audio failed'))
  expect(f.command({ text: 'Low HP' })).toEqual({})
  await Promise.resolve()
  expect(f.warn).toHaveBeenCalledOnce()
})

it('rejects non-text messages before invoking TTS', async () => {
  const f = await fixture()
  expect(f.command({ text: 42 })).toEqual({ error: 'invalid_argument' })
  expect(f.say).not.toHaveBeenCalled()
})
