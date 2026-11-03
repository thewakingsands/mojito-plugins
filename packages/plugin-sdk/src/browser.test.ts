import { isBuiltin } from 'node:module'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { MessageChannel } from 'node:worker_threads'
import { build } from 'vite'
import { expect, it, vi } from 'vitest'
import { limitNames } from './limits.js'
import { connectView } from './view.js'

it.each(['index', 'schema', 'protocol', 'messages', 'client', 'transport', 'view', 'testing'])(
  'bundles %s for a browser without Node globals or builtin imports',
  async (entry) => {
    const output = await build({
      configFile: false,
      logLevel: 'silent',
      plugins: [
        {
          name: 'reject-node-runtime',
          resolveId(source) {
            if (isBuiltin(source)) throw new Error(`Node import in browser SDK: ${source}`)
          },
        },
      ],
      build: {
        write: false,
        minify: false,
        lib: {
          entry: fileURLToPath(new URL(`./${entry}.ts`, import.meta.url)),
          name: 'MojitoSDK',
          formats: ['iife'],
        },
      },
    })
    const bundles = Array.isArray(output) ? output : [output]
    const script = bundles.flatMap((bundle) => ('output' in bundle ? bundle.output : []))
    const chunk = script.find((item) => item.type === 'chunk')
    expect(chunk?.type).toBe('chunk')
    if (chunk?.type !== 'chunk') throw new Error('Missing browser bundle')
    expect(chunk.code).not.toContain('__vite-browser-external')
    const context = { URL, TextEncoder, TextDecoder }
    runInNewContext(chunk.code, context)
    if (entry === 'schema') {
      expect(runInNewContext("MojitoSDK.id('CastNotice')", context)).toBe('CastNotice')
      expect(runInNewContext("MojitoSDK.range('^1.0.0')", context)).toBe('^1.0.0')
      expect(() => runInNewContext("MojitoSDK.id('CON.txt')", context)).toThrow()
    } else if (entry === 'index') {
      expect(runInNewContext('MojitoSDK.limitNames.includes("http.cookieBytes")', context)).toBe(true)
      expect(runInNewContext("'manifest' in MojitoSDK", context)).toBe(false)
    } else if (entry === 'protocol') {
      expect(runInNewContext('MojitoSDK.decodeValue(MojitoSDK.encodeValue(1n))', context)).toBe(1n)
    } else if (entry === 'messages') {
      expect(runInNewContext('MojitoSDK.messageKinds.includes("clockReset")', context)).toBe(true)
    }
  },
)

it('gives host events to view listeners and keeps the latest one for the first listener', async () => {
  const { port1: host, port2 } = new MessageChannel()
  const listeners = new Set<(event: unknown) => void>()
  const window = {
    addEventListener(type: string, listener: (event: unknown) => void) {
      if (type === 'message') listeners.add(listener)
    },
    removeEventListener(_type: string, listener: (event: unknown) => void) {
      listeners.delete(listener)
    },
    postMessage() {
      const event = {
        source: window,
        origin: 'mojito-plugin://runtime',
        data: { type: 'mojito:view-port' },
        ports: [port2],
      }
      queueMicrotask(() => {
        for (const listener of [...listeners]) listener(event)
      })
    },
  }
  vi.stubGlobal('window', window)
  const activationId = 'view'
  const ready = new Promise<void>((resolve) => {
    host.on('message', (message) => message.kind === 'ready' && resolve())
  })
  host.postMessage({
    protocol: 1,
    activationId,
    kind: 'hello',
    apiVersion: '1.0.0',
    identity: { id: 'Fixture', version: '1.0.0', activationId, mode: 'worker', environment: 'production' },
    limits: { schemaVersion: 1, revision: 'test', values: Object.fromEntries(limitNames.map((name) => [name, 128])) },
    capabilities: { supported: {}, granted: [] },
    clock: { now: null, base: null, source: null, generation: 0, paused: false },
    viewIdentity: {
      viewId: 'page',
      kind: 'feature',
      definitionId: 'settings',
      instanceId: null,
      placement: 'settings',
    },
  })
  const view = await connectView()
  await ready
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
  const send = (id: string, keyword: string) =>
    host.postMessage({
      protocol: 1,
      activationId,
      kind: 'event',
      name: 'navigate-to-preference-item',
      value: { id, keyword },
    })
  send('scale', 'sf')
  send('color', 'ys')
  await settle()
  const first = vi.fn(),
    second = vi.fn()
  const stop = view.on('navigate-to-preference-item', first)
  expect(first).not.toHaveBeenCalled()
  await settle()
  expect(first.mock.calls).toEqual([[{ id: 'color', keyword: 'ys' }]])
  view.on('navigate-to-preference-item', second)
  await settle()
  expect(second).not.toHaveBeenCalled()
  send('color', '')
  await settle()
  expect(first.mock.calls[1]).toEqual([{ id: 'color', keyword: '' }])
  expect(second.mock.calls).toEqual([[{ id: 'color', keyword: '' }]])
  stop()
  send('scale', '')
  await settle()
  expect(first).toHaveBeenCalledTimes(2)
  expect(second).toHaveBeenCalledTimes(2)
  host.close()
  vi.unstubAllGlobals()
})
