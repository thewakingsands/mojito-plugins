import type { HttpOptions } from '@ffcafe/mojito-plugin-sdk'
import { describe, expect, it, vi } from 'vitest'
import type { MatchaObservation } from './packets/index.js'
import { defaultSettings } from './settings.js'
import { MatchaTelemetry } from './telemetry.js'

const fate: MatchaObservation = {
  type: 'fate',
  world: 1060,
  server: 5,
  zone: 814,
  instance: 3,
  state: { id: 99, startTime: 1700000000, duration: 600, progress: 0 },
}
const npc: MatchaObservation = {
  type: 'npc',
  world: 1060,
  server: 5,
  zone: 814,
  instance: 3,
  state: {
    id: 123,
    bNpcName: 2919,
    location: 55,
    fate: 99,
    level: 50,
    curHP: 100,
    maxHP: 200,
    position: { x: 10, y: 20, z: 30 },
  },
}
const response = { status: 200, headers: {}, url: 'https://example.test/', body: new Uint8Array() }
function setup(enabled = true) {
  let now = 1700000000000
  const settings = {
    ...defaultSettings.telemetry,
    enabled,
    root: 'https://example.test/telemetry',
    fateBucket: 'fates',
    npcBucket: 'npcs',
    clientId: 'anonymous-id',
  }
  const request = vi.fn(async (_url: string, _options?: HttpOptions) => response)
  const onDiagnostic = vi.fn()
  const telemetry = new MatchaTelemetry({
    http: { request },
    getSettings: () => settings,
    now: () => now,
    version: '0.1.0',
    onDiagnostic,
  })
  return {
    telemetry,
    settings,
    request,
    onDiagnostic,
    advance: (amount: number) => {
      now += amount
    },
  }
}
const body = (options?: HttpOptions) => JSON.parse(options?.body as string)

describe('explicitly enabled Matcha telemetry', () => {
  it('never records disabled observations for later upload', async () => {
    const { telemetry, settings, request, advance } = setup(false)
    telemetry.observe([fate, npc])
    advance(10000)
    await telemetry.tick()
    settings.enabled = true
    await telemetry.tick()
    advance(10000)
    await telemetry.tick()
    expect(request).not.toHaveBeenCalled()
  })

  it('aggregates for ten seconds and sends separate correctly scoped FATE/NPC arrays', async () => {
    const { telemetry, request, advance } = setup()
    telemetry.observe([fate, npc])
    advance(9999)
    await telemetry.tick()
    expect(request).not.toHaveBeenCalled()
    advance(1)
    await telemetry.tick()
    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      'https://example.test/telemetry/fates/batch',
      'https://example.test/telemetry/npcs/batch',
    ])
    expect(body(request.mock.calls[0][1])).toEqual([
      {
        world: 1060,
        server: 5,
        zone: 814,
        instance: 3,
        client_id: 'anonymous-id',
        version: '0.1.0',
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        timestamp: 1700000000000,
        fate: 99,
        start_time: 1700000000,
        duration: 600,
        progress: 0,
      },
    ])
    expect(body(request.mock.calls[1][1])[0]).toMatchObject({
      cid: 123,
      npc: 2919,
      cur_hp: 100,
      max_hp: 200,
      x: 10,
      y: 20,
      z: 30,
      location: 55,
    })
    advance(20000)
    await telemetry.tick()
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('coalesces an entity to its terminal state and keeps different worlds and instances separate', async () => {
    const { telemetry, request, advance } = setup()
    telemetry.observe([fate, npc])
    advance(1000)
    telemetry.observe([
      { ...fate, state: { ...fate.state, progress: -1 } },
      { ...npc, state: { ...npc.state, curHP: 0, position: { x: 0, y: 0, z: 0 } } },
      { ...fate, world: 1061 },
      { ...fate, instance: 2 },
    ])
    advance(9000)
    await telemetry.tick()
    const fates = body(request.mock.calls[0][1])
    expect(fates).toHaveLength(3)
    expect(fates[0]).toMatchObject({ progress: -1, timestamp: 1700000001000 })
    expect(body(request.mock.calls[1][1])[0]).toMatchObject({ cur_hp: 0, x: 0, y: 0, z: 0 })
  })

  it('does not retry failed or uncertain batches', async () => {
    const { telemetry, request, onDiagnostic, advance } = setup()
    request.mockRejectedValueOnce(new Error('network interrupted'))
    telemetry.observe([fate])
    advance(10000)
    await telemetry.tick()
    advance(10000)
    await telemetry.tick()
    expect(request).toHaveBeenCalledTimes(1)
    expect(onDiagnostic).toHaveBeenCalledExactlyOnceWith('Telemetry fate batch failed; batch discarded')
  })

  it.each(['reset', 'dispose', 'disabled', 'endpoint'] as const)('aborts and clears when %s occurs', async (action) => {
    const { telemetry, settings, request, onDiagnostic, advance } = setup()
    let finish: () => void = () => {}
    request.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(response)
        }),
    )
    telemetry.observe([fate])
    advance(10000)
    const pending = telemetry.tick()
    const signal = request.mock.calls[0][1]?.signal
    telemetry.observe([npc])
    if (action === 'reset') telemetry.reset()
    if (action === 'dispose') telemetry.dispose()
    if (action === 'disabled') {
      settings.enabled = false
      await telemetry.tick()
    }
    if (action === 'endpoint') {
      settings.root = 'https://changed.test'
      await telemetry.tick()
    }
    expect(signal?.aborted).toBe(true)
    finish()
    await pending
    advance(10000)
    await telemetry.tick()
    expect(request).toHaveBeenCalledTimes(1)
    expect(onDiagnostic).not.toHaveBeenCalled()
  })

  it('bounds queued observations and refuses unsafe endpoint construction or unknown world state', async () => {
    const { telemetry, settings, request, onDiagnostic, advance } = setup()
    telemetry.observe(Array.from({ length: 1025 }, (_, i) => ({ ...fate, state: { ...fate.state, id: i + 1 } })))
    advance(10000)
    await telemetry.tick()
    expect(body(request.mock.calls[0][1])).toHaveLength(1024)
    expect(onDiagnostic).toHaveBeenCalledTimes(1)
    telemetry.observe([{ ...fate, world: 0 }])
    advance(10000)
    await telemetry.tick()
    settings.fateBucket = '..'
    telemetry.observe([fate])
    advance(10000)
    await telemetry.tick()
    settings.fateBucket = 'fates'
    settings.root = 'http://example.test'
    telemetry.observe([fate])
    advance(10000)
    await telemetry.tick()
    expect(request).toHaveBeenCalledTimes(1)
  })
})
