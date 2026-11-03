import type { PluginContext, Value } from '@ffcafe/mojito-plugin-sdk'
import type { OverlayState } from '@ffcafe/mojito-plugin-sdk/overlayplugin'
import { expect, it, vi } from 'vitest'
import { overlayService, provideOverlayService } from './overlay-service.js'

const state = (): OverlayState => ({
  apiVersion: 1,
  encounterId: null,
  combatData: null,
  primaryPlayer: null,
  zone: null,
  language: null,
  inCombat: null,
  availability: Object.fromEntries(
    ['combatData', 'primaryPlayer', 'zone', 'language', 'inCombat'].map((key) => [
      key,
      { state: 'unavailable', reason: 'Synthetic missing data' },
    ]),
  ) as OverlayState['availability'],
})
it('retains an immutable snapshot, publishes revisions and preserves encounter command results', async () => {
  let handler!: (request: { method: string; payload: Value }) => Promise<Value>
  const published: Value[] = [],
    release = vi.fn(),
    end = vi.fn(async () => 'staleEncounter' as const)
  const ctx = {
    services: {
      provide: vi.fn(async (_definition: unknown, receive: typeof handler) => {
        handler = receive
        return release
      }),
      publish: async (_name: string, _event: string, value: Value) => {
        published.push(structuredClone(value))
      },
    },
  } as unknown as PluginContext
  let queue = Promise.resolve()
  const enqueue = <T>(task: () => T | Promise<T>) => {
    const next = queue.then(task)
    queue = next.then(
      () => {},
      () => {},
    )
    return next
  }
  const service = await provideOverlayService(ctx, enqueue, end)
  expect(ctx.services.provide).toHaveBeenCalledWith(overlayService, expect.any(Function))
  await expect(handler({ method: 'getState', payload: null })).rejects.toMatchObject({ code: 'unavailable' })
  const input = state()
  await enqueue(() => service.publish(input))
  input.encounterId = 'mutated outside provider'
  expect(await handler({ method: 'getState', payload: null })).toEqual(published[0])
  expect(published[0]).toMatchObject({ revision: 1, state: { encounterId: null } })
  await enqueue(() => service.publish(state()))
  expect(await handler({ method: 'getState', payload: null })).toMatchObject({ revision: 2 })
  expect(await handler({ method: 'endEncounter', payload: { encounterId: 'shown' } })).toEqual({
    result: 'staleEncounter',
  })
  expect(end).toHaveBeenCalledExactlyOnceWith('shown')
  await expect(handler({ method: 'endEncounter', payload: { encounterId: 'shown', other: true } })).rejects.toThrow()
  await expect(handler({ method: 'unknown', payload: null })).rejects.toMatchObject({ code: 'invalid_argument' })
  await service.dispose()
  expect(release).toHaveBeenCalledOnce()
  await expect(handler({ method: 'getState', payload: null })).rejects.toMatchObject({ code: 'plugin_stopped' })
  await expect(service.publish(state())).rejects.toMatchObject({ code: 'plugin_stopped' })
})
