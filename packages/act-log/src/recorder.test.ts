import type { BatchListener, Observation, PluginContext, Sample } from '@ffcafe/mojito-plugin-sdk'
import { expect, it, vi } from 'vitest'
import { Recorder } from './recorder.js'

function fixture() {
  const chunks: string[] = []
  const write = vi.fn(async (bytes: Uint8Array) => {
    chunks.push(new TextDecoder().decode(bytes))
  })
  const close = vi.fn(async () => {})
  let resolve!: (result: { reason: string }) => void
  const promise = new Promise<{ reason: string }>((handler) => {
    resolve = handler
  })
  const done = { promise, resolve }
  let consume!: BatchListener<Sample<Observation>>
  const finish = vi.fn(async () => {
    done.resolve({ reason: 'completed' })
  })
  const grants: Record<string, { state: string }> = {
    'packets.read': { state: 'available' },
    'identity.read': { state: 'available' },
  }
  const openWriteFile = vi.fn(async () => ({ name: 'synthetic.log', write, close }))
  const ctx = {
    capabilities: { get: () => grants },
    host: { openWriteFile },
    observations: {
      subscribe: (_selection: unknown, listener: typeof consume) => {
        consume = listener
        return { ready: Promise.resolve(), closed: done.promise, finish }
      },
    },
    limits: { values: { 'transport.messageBytes': 4096 } },
    data: {},
  }
  const recorder = new Recorder(ctx as unknown as PluginContext, () => {})
  const push = (...messages: string[]) =>
    consume({
      subscriptionId: 'synthetic',
      batchId: 0,
      firstSeq: 0,
      lastSeq: messages.length - 1,
      initial: false,
      complete: true,
      items: messages.map((message) => ({
        meta: {
          sessionId: 'synthetic',
          characterGeneration: 0,
          source: 'replay',
          observedAt: 2000,
          timeBase: 'packet-unix',
          clockGeneration: 0,
          sampleStartedAt: null,
          sampleEndedAt: null,
        },
        value: {
          kind: 'event',
          event: {
            type: 'gameLog',
            data: { time: 2, code: 3, sender: new Uint8Array(), message: new TextEncoder().encode(message) },
          },
        },
      })),
    })
  return { recorder, openWriteFile, write, close, done, push, finish, chunks, grants }
}
it('returns to idle and reports denied permissions without opening a writer', async () => {
  const { recorder, openWriteFile, grants } = fixture()
  grants['packets.read'].state = 'denied'
  await recorder.start()
  expect(recorder.state).toEqual({ status: 'idle', name: '', lines: 0, error: '请在插件权限中允许读取数据包' })
  expect(openWriteFile).not.toHaveBeenCalled()
})
it('returns to idle after a failure to open a file and allows another attempt', async () => {
  const { recorder, openWriteFile, close } = fixture()
  openWriteFile.mockRejectedValueOnce(new Error('Cannot open save dialog'))
  await recorder.start()
  expect(recorder.state).toEqual({ status: 'idle', name: '', lines: 0, error: 'Cannot open save dialog' })
  expect(close).not.toHaveBeenCalled()
  await recorder.start()
  expect(recorder.state).toEqual({ status: 'waiting', name: 'synthetic.log', lines: 0, error: '' })
  await recorder.stop()
})
it('keeps the selected file visible when permissions are lost after it is opened', async () => {
  const { recorder, openWriteFile, write, close, grants } = fixture()
  openWriteFile.mockImplementationOnce(async () => {
    grants['identity.read'].state = 'denied'
    return { name: 'synthetic.log', write, close }
  })
  await recorder.start()
  expect(recorder.state).toEqual({
    status: 'incomplete',
    name: 'synthetic.log',
    lines: 0,
    error: '请在插件权限中允许读取角色身份',
  })
  expect(close).toHaveBeenCalledTimes(1)
})
it('preserves a complete prefix and writes a genuine error record when a chat field cannot be rendered', async () => {
  const { recorder, push, done, close, chunks } = fixture()
  await recorder.start()
  await expect(push('first', 'bad|field')).rejects.toThrow('聊天')
  done.resolve({ reason: 'consumer_failed' })
  await vi.waitFor(() => expect(recorder.state.status).toBe('incomplete'))
  expect(chunks.map((line) => line.split('|')[0])).toEqual(['00', '254'])
  expect(recorder.state.lines).toBe(2)
  expect(close).toHaveBeenCalledTimes(1)
})
it('fails on disk errors without reporting a successful stop or retrying a possibly partial write', async () => {
  const { recorder, push, done, write, close } = fixture()
  write.mockRejectedValueOnce(new Error('disk full'))
  await recorder.start()
  await expect(push('first')).rejects.toThrow('disk full')
  done.resolve({ reason: 'consumer_failed' })
  await vi.waitFor(() => expect(recorder.state.status).toBe('incomplete'))
  expect(recorder.state.lines).toBe(0)
  expect(write).toHaveBeenCalledTimes(1)
  expect(close).toHaveBeenCalledTimes(1)
})
it('closes an idle writer on stop and closes a running writer when a grant changes', async () => {
  const f = fixture()
  await f.recorder.start()
  await f.recorder.stop()
  expect(f.recorder.state.status).toBe('stopped')
  expect(f.finish).toHaveBeenCalledTimes(1)
  const second = fixture()
  await second.recorder.start()
  second.grants['identity.read'].state = 'denied'
  await expect(second.push('private')).rejects.toThrow('权限')
  second.done.resolve({ reason: 'permission_denied' })
  await vi.waitFor(() => expect(second.recorder.state.status).toBe('incomplete'))
  expect(second.write).not.toHaveBeenCalled()
  expect(second.close).toHaveBeenCalledTimes(1)
})
