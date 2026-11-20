import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

it('maps historical abbreviations and keeps non-job marks out of the request', async () => {
  const { jobId, loadJobIcon } = await import('./job-icons.js')
  const callHandler = vi.fn()
  vi.stubGlobal('window', { OverlayPluginApi: { callHandler } })
  expect(['gld', 'pug', 'lwr', 'bot', 'BST'].map(jobId)).toEqual([1, 2, 12, 17, 43])
  for (const mark of ['', 'PET', 'LMB', 'ENC']) expect(await loadJobIcon(jobId(mark))).toBeNull()
  expect(callHandler).not.toHaveBeenCalled()
})

it('shares an in-flight lookup and a successful URL for the current document only', async () => {
  let reply!: (result: string) => void
  const callHandler = vi.fn((_input: string, callback: typeof reply) => {
    reply = callback
  })
  vi.stubGlobal('window', { OverlayPluginApi: { callHandler } })
  const { loadJobIcon } = await import('./job-icons.js')
  const first = loadJobIcon(19)
  expect(loadJobIcon(19)).toBe(first)
  reply(JSON.stringify('client-image'))
  expect(await first).toBe('client-image')
  expect(await loadJobIcon(19)).toBe('client-image')
  expect(callHandler).toHaveBeenCalledTimes(1)
  vi.resetModules()
  const next = (await import('./job-icons.js')).loadJobIcon(19)
  expect(callHandler).toHaveBeenCalledTimes(2)
  reply('null')
  expect(await next).toBeNull()
})

it('allows a new lookup after an unavailable host or unsuccessful response', async () => {
  const { loadJobIcon } = await import('./job-icons.js')
  vi.stubGlobal('window', {})
  expect(await loadJobIcon(21)).toBeNull()
  const results = ['{"error":"unavailable"}', 'null', '', '"available"']
  const callHandler = vi.fn((_input: string, reply: (raw: string) => void) => reply(results.shift()!))
  vi.stubGlobal('window', { OverlayPluginApi: { callHandler } })
  for (const expected of [null, null, null, 'available']) expect(await loadJobIcon(21)).toBe(expected)
  expect(callHandler).toHaveBeenCalledTimes(4)
})
