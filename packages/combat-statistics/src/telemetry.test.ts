import { deviates, type TelemetrySample } from '@ffcafe/mojito-combat-model'
import type { Capability, PluginContext } from '@ffcafe/mojito-plugin-sdk'
import { expect, it, vi } from 'vitest'
import fixture from '../testdata/telemetry-v1.json' with { type: 'json' }
import { randomEventId, TELEMETRY_URL, Telemetry } from './telemetry.js'

const context = {
  producerVersion: '0.3.0',
  modelVersion: '7.57',
  dataGameVersion: '2026.10.06.0000.0000',
  opcodeVersion: '7.57',
  territoryId: 123,
}
const sample: TelemetrySample = {
  casterId: 1,
  targetId: 2,
  classJob: 25,
  level: 100,
  actionId: 12345,
  damageType: 'magic',
  correctedDamagePerPotency: 100,
  unknownStatuses: [],
}
function setup(status = 201) {
  const http = { request: vi.fn().mockResolvedValue({ status }) }
  const capabilities = { get: vi.fn((): Record<string, Capability> => ({ 'http.request': { state: 'available' } })) }
  const log = { warn: vi.fn() }
  const telemetry = new Telemetry({ http, capabilities, log } as unknown as PluginContext, () => fixture.event.eventId)
  const fill = () => {
    for (let i = 0; i < 12; i++) telemetry.add(sample)
    for (let i = 0; i < 8; i++)
      telemetry.add({
        ...sample,
        correctedDamagePerPotency: 70,
        unknownStatuses: fixture.event.payload.observations[0].unknownStatuses,
      })
  }
  return { telemetry, http, capabilities, log, fill }
}
it('shares the Go boundary fixture and emits exactly its anonymous envelope', async () => {
  for (const { r, b, accept } of fixture.boundaries) expect(deviates(r, b)).toBe(accept)
  const { telemetry, http, fill } = setup()
  telemetry.start('one', context)
  fill()
  telemetry.end('one', 'outOfCombat', true)
  expect(http.request).not.toHaveBeenCalled()
  telemetry.flush()
  await Promise.resolve()
  expect(http.request).toHaveBeenCalledTimes(1)
  const [url, options] = http.request.mock.calls[0]
  expect(url).toBe(TELEMETRY_URL)
  expect(JSON.parse(options.body)).toEqual(fixture.event)
  expect(options).toMatchObject({ credentials: 'omit', timeoutMs: 5000, method: 'POST' })
  telemetry.end('one', 'manual', false)
  telemetry.flush()
  expect(http.request).toHaveBeenCalledTimes(1)
})
it.each([200, 201, 429, 500, 503])('makes one attempt with HTTP %s', async (status) => {
  const { telemetry, http, fill } = setup(status)
  telemetry.start('one', context)
  fill()
  telemetry.end('one', 'manual', false)
  await Promise.resolve()
  telemetry.flush()
  expect(http.request).toHaveBeenCalledTimes(1)
})
it('does not retry transport failures and cancels in flight on disable', async () => {
  const { telemetry, http, fill, log } = setup()
  http.request.mockRejectedValue(new Error('private data must not reach logs'))
  telemetry.start('one', context)
  fill()
  telemetry.end('one', 'quiet', false)
  telemetry.stop()
  await Promise.resolve()
  expect(http.request).toHaveBeenCalledTimes(1)
  expect(http.request.mock.calls[0][1].signal.aborted).toBe(true)
  expect(JSON.stringify(log.warn.mock.calls)).not.toContain('private data')
})
it('skips invalid boundaries and revoked permissions, while allowing next encounter', () => {
  const { telemetry, http, capabilities, fill } = setup()
  for (const reason of ['sourceChanged', 'zoneChanged', 'stopped', 'inputUnavailable']) {
    telemetry.start(reason, context)
    fill()
    telemetry.end(reason, reason, false)
  }
  telemetry.start('denied', context)
  fill()
  capabilities.get.mockReturnValue({ 'http.request': { state: 'denied' } })
  telemetry.end('denied', 'manual', false)
  expect(http.request).not.toHaveBeenCalled()
  capabilities.get.mockReturnValue({ 'http.request': { state: 'available' } })
  telemetry.start('ok', context)
  fill()
  telemetry.end('ok', 'manual', false)
  expect(http.request).toHaveBeenCalledTimes(1)
})
it('uses a random UUID v4 without actor or activation identifiers', () => {
  const ids = new Set(Array.from({ length: 100 }, () => randomEventId()))
  expect(ids.size).toBe(100)
  for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})

it.each([{ state: 'denied' } as const, { state: 'unavailable', reason: 'network unavailable' } as const])(
  'does not collect or send while HTTP is $state, and starts fresh after recovery',
  async (capability) => {
    const { telemetry, http, capabilities, fill } = setup()
    capabilities.get.mockReturnValue({ 'http.request': capability })
    telemetry.start('unavailable', context)
    fill()
    telemetry.end('unavailable', 'manual', false)
    expect(http.request).not.toHaveBeenCalled()
    capabilities.get.mockReturnValue({ 'http.request': { state: 'available' } })
    telemetry.start('available', context)
    fill()
    telemetry.end('available', 'manual', false)
    await Promise.resolve()
    expect(http.request).toHaveBeenCalledTimes(1)
  },
)
it('invalidates an active encounter and aborts pending HTTP when permission is revoked', async () => {
  const { telemetry, http, capabilities, fill } = setup()
  telemetry.start('collecting', context)
  fill()
  capabilities.get.mockReturnValue({ 'http.request': { state: 'denied' } })
  telemetry.flush()
  capabilities.get.mockReturnValue({ 'http.request': { state: 'available' } })
  telemetry.end('collecting', 'manual', false)
  expect(http.request).not.toHaveBeenCalled()
  http.request.mockImplementation(() => new Promise(() => {}))
  telemetry.start('sending', context)
  fill()
  telemetry.end('sending', 'manual', false)
  const signal = http.request.mock.calls[0][1].signal as AbortSignal
  capabilities.get.mockReturnValue({ 'http.request': { state: 'denied' } })
  expect(telemetry.permitted()).toBe(false)
  expect(signal.aborted).toBe(true)
})
