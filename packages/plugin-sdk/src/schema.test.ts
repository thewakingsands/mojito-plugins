import { expect, it } from 'vitest'
import { ttsChannels } from './manifest.js'
import { id, manifest, pluginApiVersion, serviceId, supportsApiVersion } from './schema.js'

const base = {
  schemaVersion: 1,
  id: 'example.fixture',
  name: 'Fixture',
  version: '1.0.0',
  apiVersion: '^2.0.0',
  entry: { kind: 'worker', path: 'worker.js' },
  capabilities: ['events.read', 'identity.read'],
  networkOrigins: ['https://example.com', 'http://192.168.1.10:8080'],
}

it('accepts the capability list and http: or https: origins of plugin API 2.0', () => {
  expect(manifest(base).capabilities).toEqual(['events.read', 'identity.read'])
})

it('names a capability the host no longer has', () => {
  expect(() => manifest({ ...base, capabilities: ['host.files'] })).toThrow(/host\.files.*重新构建/)
  expect(() => manifest({ ...base, capabilities: { required: [], optional: [] } })).toThrow()
})

it('rejects origins with a path or another scheme', () => {
  expect(() => manifest({ ...base, networkOrigins: ['https://example.com/api'] })).toThrow()
  expect(() => manifest({ ...base, networkOrigins: ['ftp://example.com'] })).toThrow()
})

it('takes plugin IDs of exactly two lowercase segments', () => {
  for (const ok of ['ffcafe.matcha', 'ffcafe.tts-deepseek', 'some_author.plugin-2', `a.${'b'.repeat(62)}`])
    expect(id(ok)).toBe(ok)
  for (const bad of ['FFCafe.Matcha', 'matcha', 'a.b.c', '.matcha', 'ffcafe.', 'a b.c', `a.${'b'.repeat(63)}`])
    expect(() => id(bad), bad).toThrow('Invalid plugin ID')
  expect(() => id('con.foo')).toThrow('Windows reserved device name')
})

it('takes local service names from providers and full names from consumers', () => {
  const services = {
    provides: [{ name: 'overlay', version: '1.0.0' }],
    consumes: [{ name: 'ffcafe.combat-statistics/overlay', versionRange: '^1.0.0', optional: true }],
  }
  expect(manifest({ ...base, services }).services).toEqual(services)
  expect(() =>
    manifest({ ...base, services: { consumes: [{ name: 'overlay', versionRange: '^1.0.0', optional: true }] } }),
  ).toThrow()
  expect(() => manifest({ ...base, services: { provides: [{ name: 'A/overlay', version: '1.0.0' }] } })).toThrow()
  expect(serviceId('ffcafe.combat-statistics/overlay')).toEqual({
    pluginId: 'ffcafe.combat-statistics',
    name: 'overlay',
  })
  expect(() => serviceId('CombatStatistics/overlay')).toThrow('Invalid plugin ID')
})

it('takes TTS channels whose ids are service names, and always has a default channel', () => {
  const tts = { channels: [{ id: 'alarm', name: '警报' }] }
  expect(ttsChannels(manifest({ ...base, capabilities: ['tts.say'], tts }))).toEqual([
    { id: 'default', name: '默认' },
    { id: 'alarm', name: '警报' },
  ])
  expect(ttsChannels({ tts: { channels: [{ id: 'default', name: '通知' }] } })).toEqual([
    { id: 'default', name: '通知' },
  ])
  expect(ttsChannels({})).toEqual([{ id: 'default', name: '默认' }])
  expect(() => manifest({ ...base, tts: { channels: [{ id: 'Alarm', name: '警报' }] } })).toThrow()
  expect(() => manifest({ ...base, tts: { channels: [{ id: 'alarm', name: '' }] } })).toThrow()
  expect(() => manifest({ ...base, tts: { channels: [{ id: 'alarm', name: 'a', level: 1 }] } })).toThrow()
  expect(() => manifest({ ...base, tts: { channels: [tts.channels[0], tts.channels[0]] } })).toThrow(/Duplicate/)
})

it('accepts earlier Plugin API 2 manifests as well as target enmity manifests', () => {
  expect(pluginApiVersion).toBe('2.6.0')
  for (const range of ['^2.0.0', '^2.4.0', '^2.5.0', '^2.6.0']) expect(supportsApiVersion(range)).toBe(true)
  expect(supportsApiVersion('<2.6.0')).toBe(false)
})
