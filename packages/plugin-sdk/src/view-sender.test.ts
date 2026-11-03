import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { pluginError } from './errors.js'
import type { Value } from './types.js'
import { ViewSender } from './view-sender.js'

interface Fixture {
  sender: ViewSender
  sent: [string, Value][]
  warnings: Value[]
  controller: AbortController
  /** Calls stay pending until released, so a test can observe a round in flight. */
  hold(): () => void
  reject(channel: string, code: 'quota_exceeded'): void
}

function fixture(): Fixture {
  const sent: [string, Value][] = []
  const warnings: Value[] = []
  const controller = new AbortController()
  let gate: Promise<void> | undefined
  const rejected = new Map<string, string>()
  const sender = new ViewSender(
    async (channel, payload) => {
      if (gate) await gate
      const code = rejected.get(channel)
      if (code) {
        rejected.delete(channel)
        throw pluginError(code as 'quota_exceeded')
      }
      sent.push([channel, payload])
    },
    (_message, fields) => warnings.push(fields),
    controller.signal,
  )
  return {
    sender,
    sent,
    warnings,
    controller,
    hold() {
      let release!: () => void
      gate = new Promise((resolve) => (release = resolve))
      return () => {
        gate = undefined
        release()
      }
    },
    reject: (channel, code) => rejected.set(channel, code),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

it('sends only the latest value of each channel set in the same turn', async () => {
  const f = fixture()
  f.sender.set('a', 1)
  f.sender.set('b', 2)
  f.sender.set('a', 3)
  expect(f.sent).toEqual([])
  await vi.advanceTimersByTimeAsync(0)
  expect(f.sent).toEqual([
    ['a', 3],
    ['b', 2],
  ])
})

it('waits for the interval after a send, and sends at once when the interval has passed', async () => {
  const f = fixture()
  f.sender.set('a', 1)
  await vi.advanceTimersByTimeAsync(0)
  await vi.advanceTimersByTimeAsync(50)
  f.sender.set('a', 2)
  await vi.advanceTimersByTimeAsync(149)
  expect(f.sent).toEqual([['a', 1]])
  await vi.advanceTimersByTimeAsync(1)
  expect(f.sent).toEqual([
    ['a', 1],
    ['a', 2],
  ])
  await vi.advanceTimersByTimeAsync(500)
  f.sender.set('a', 3)
  await vi.advanceTimersByTimeAsync(0)
  expect(f.sent.at(-1)).toEqual(['a', 3])
})

it('starts no second round while one is in flight', async () => {
  const f = fixture()
  const release = f.hold()
  f.sender.set('a', 1)
  await vi.advanceTimersByTimeAsync(0)
  f.sender.set('a', 2)
  await vi.advanceTimersByTimeAsync(1000)
  expect(f.sent).toEqual([])
  release()
  await vi.advanceTimersByTimeAsync(0)
  expect(f.sent).toEqual([
    ['a', 1],
    ['a', 2],
  ])
})

it('flush cancels the waiting timer and resolves after the host handled every value', async () => {
  const f = fixture()
  f.sender.set('a', 1)
  await vi.advanceTimersByTimeAsync(0)
  f.sender.set('a', 2)
  const release = f.hold()
  let done = false
  const flushed = f.sender.flush().then(() => (done = true))
  await vi.advanceTimersByTimeAsync(0)
  expect(done).toBe(false)
  release()
  await flushed
  expect(f.sent).toEqual([
    ['a', 1],
    ['a', 2],
  ])
  await vi.advanceTimersByTimeAsync(1000)
  expect(f.sent).toHaveLength(2)
})

it('flush waits for the round in flight before sending the rest', async () => {
  const f = fixture()
  const release = f.hold()
  f.sender.set('a', 1)
  await vi.advanceTimersByTimeAsync(0)
  f.sender.set('b', 2)
  const flushed = f.sender.flush()
  release()
  await flushed
  expect(f.sent).toEqual([
    ['a', 1],
    ['b', 2],
  ])
})

it('logs a rejected value, sends the others, and throws the failure once on the next call', async () => {
  const f = fixture()
  f.reject('a', 'quota_exceeded')
  f.sender.set('a', 1)
  f.sender.set('b', 2)
  await vi.advanceTimersByTimeAsync(0)
  expect(f.sent).toEqual([['b', 2]])
  expect(f.warnings).toEqual([{ channel: 'a', code: 'quota_exceeded' }])
  expect(() => f.sender.set('a', 3)).toThrow(expect.objectContaining({ code: 'quota_exceeded' }))
  await vi.advanceTimersByTimeAsync(1000)
  expect(f.sent).toEqual([['b', 2]])
  f.sender.set('a', 4)
  await f.sender.flush()
  expect(f.sent.at(-1)).toEqual(['a', 4])

  f.reject('a', 'quota_exceeded')
  f.sender.set('a', 5)
  await expect(f.sender.flush()).rejects.toMatchObject({ code: 'quota_exceeded' })
  await f.sender.flush()
  expect(f.warnings).toHaveLength(2)
})

it('a cancelled flush rejects without stopping the scheduled send', async () => {
  const f = fixture()
  const release = f.hold()
  f.sender.set('a', 1)
  const controller = new AbortController()
  const flushed = f.sender.flush({ signal: controller.signal })
  controller.abort()
  await expect(flushed).rejects.toMatchObject({ code: 'cancelled' })
  release()
  await vi.advanceTimersByTimeAsync(0)
  expect(f.sent).toEqual([['a', 1]])
  await expect(f.sender.flush({ signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' })
})

it('stops sending once the activation stops', async () => {
  const f = fixture()
  f.sender.set('a', 1)
  f.controller.abort()
  await vi.advanceTimersByTimeAsync(1000)
  expect(f.sent).toEqual([])
  expect(() => f.sender.set('a', 2)).toThrow(expect.objectContaining({ code: 'plugin_stopped' }))
  await expect(f.sender.flush()).rejects.toMatchObject({ code: 'plugin_stopped' })
})
