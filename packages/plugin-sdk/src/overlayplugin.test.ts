import { expect, it } from 'vitest'
import type { ViewsService } from './context.js'
import {
  formatMetric,
  type OverlayState,
  overlayCompatibility,
  overlayProducer,
  overlayState,
} from './overlayplugin.js'

const state = (): OverlayState => ({
  apiVersion: 1,
  encounterId: 'first',
  combatData: { Encounter: { encdps: '12.50' }, Combatant: {}, isActive: 'false' },
  primaryPlayer: null,
  zone: null,
  language: 'en',
  inCombat: null,
  availability: {
    combatData: { state: 'partial', reason: 'No healing input' },
    primaryPlayer: { state: 'unavailable', reason: 'No player' },
    zone: { state: 'unavailable', reason: 'No territory' },
    language: { state: 'available' },
    inCombat: { state: 'unavailable', reason: 'Game state unsupported' },
  },
})
it('preserves missing metrics and partial availability without fabricating zero', () => {
  expect(formatMetric(null)).toBeUndefined()
  expect(formatMetric(0)).toBe('0.00')
  expect(() => formatMetric(NaN)).toThrow()
  const value = state(),
    copy = overlayState(value)
  value.combatData!.Encounter.encdps = '99'
  expect(copy.combatData!.Encounter.encdps).toBe('12.50')
  expect(() => overlayState({ ...value, inCombat: false })).toThrow()
  expect(() => overlayState({ ...value, encounterId: null })).toThrow()
  expect(() =>
    overlayCompatibility({
      kind: 'overlayplugin',
      protocol: 'modern',
      channel: 'x',
      source: { kind: 'remote', profileId: 'x', url: 'https://example.com' },
    }),
  ).toThrow()
})
it('flushes the previous encounter before setting the next one, and merges states of one encounter', async () => {
  const records: string[] = []
  const producer = overlayProducer(
    {
      set(_channel, value) {
        records.push(`set:${(value as unknown as OverlayState).encounterId}`)
      },
      async flush() {
        records.push('flush')
      },
    } as ViewsService,
    'combat',
  )
  const running = state()
  running.combatData!.isActive = 'true'
  await producer.publish(running)
  await producer.publish(state())
  await producer.publish({ ...running, encounterId: 'second' })
  expect(records).toEqual(['set:first', 'set:first', 'flush', 'set:second'])
})

it('accepts only package documents and host-managed remote profiles', () => {
  const input = {
    kind: 'overlayplugin',
    protocol: 'legacy-dom',
    channel: 'combat',
    source: { kind: 'package', entry: 'overlay/index.html', documents: ['overlay/index.html', 'config/index.html'] },
  }
  expect(overlayCompatibility(input)).toEqual(input)
  for (const source of [
    { ...input.source, entry: '../outside' },
    { ...input.source, documents: ['https://example.com/index.html'] },
    { ...input.source, documents: [] },
    { ...input.source, documents: ['config/index.html'] },
    { ...input.source, documents: ['overlay/index.html', 'overlay/index.html'] },
    { kind: 'local', templateId: 'kagerou' },
  ])
    expect(() => overlayCompatibility({ ...input, source })).toThrow()
})
