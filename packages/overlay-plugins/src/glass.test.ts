import type { PluginContext, Value } from '@ffcafe/mojito-plugin-sdk'
import { expect, it, vi } from 'vitest'
import { activate } from './glass.js'
import { activateOverlay } from './worker.js'

vi.mock('./worker.js', () => ({ activateOverlay: vi.fn() }))

function fixture() {
  const handlers = new Map<string, (input: Value) => Value | Promise<Value>>()
  const disposers = new Map<string, ReturnType<typeof vi.fn>>()
  const play = vi.fn<PluginContext['audio']['play']>()
  const ctx = {
    views: {
      onCommand: async (name: string, handler: (input: Value) => Value | Promise<Value>) => {
        handlers.set(name, handler)
        const dispose = vi.fn()
        disposers.set(name, dispose)
        return dispose
      },
    },
    audio: { play },
  } as unknown as PluginContext
  return { ctx, handlers, disposers, play }
}

it('passes the sound path to the host verbatim and preserves errors and disposal', async () => {
  const f = fixture()
  const stopOverlay = vi.fn()
  vi.mocked(activateOverlay).mockResolvedValueOnce(stopOverlay)
  const stop = await activate(f.ctx)
  const playSound = f.handlers.get('combat/playSound')!
  expect(await playSound({ file: 5 })).toEqual({ error: 'invalid_argument' })
  expect(f.play).not.toHaveBeenCalled()
  expect(await playSound({ file: 'sounds/another.wav' })).toEqual({})
  expect(f.play).toHaveBeenLastCalledWith({ path: 'sounds/another.wav' })
  const error = new Error('host rejected the path')
  f.play.mockRejectedValueOnce(error)
  await expect(playSound({ file: '../outside.wav' })).rejects.toBe(error)
  expect(f.play).toHaveBeenLastCalledWith({ path: '../outside.wav' })
  await stop()
  expect(f.disposers.get('combat/playSound')).toHaveBeenCalledOnce()
  expect(f.disposers.get('combat/say')).toHaveBeenCalledOnce()
  expect(stopOverlay).toHaveBeenCalledOnce()
})

it('releases both commands if overlay activation fails', async () => {
  const f = fixture()
  vi.mocked(activateOverlay).mockRejectedValueOnce(new Error('activation failed'))
  await expect(activate(f.ctx)).rejects.toThrow('activation failed')
  expect(f.disposers.get('combat/playSound')).toHaveBeenCalledOnce()
  expect(f.disposers.get('combat/say')).toHaveBeenCalledOnce()
})
