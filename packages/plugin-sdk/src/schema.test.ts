import { expect, it } from 'vitest'
import { manifest, serviceId } from './schema.js'

const base = {
  schemaVersion: 1,
  id: 'Fixture',
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

it('takes local service names from providers and full names from consumers', () => {
  const services = {
    provides: [{ name: 'overlay', version: '1.0.0' }],
    consumes: [{ name: 'CombatStatistics/overlay', versionRange: '^1.0.0', optional: true }],
  }
  expect(manifest({ ...base, services }).services).toEqual(services)
  expect(() =>
    manifest({ ...base, services: { consumes: [{ name: 'overlay', versionRange: '^1.0.0', optional: true }] } }),
  ).toThrow()
  expect(() => manifest({ ...base, services: { provides: [{ name: 'A/overlay', version: '1.0.0' }] } })).toThrow()
  expect(serviceId('CombatStatistics/overlay')).toEqual({ pluginId: 'CombatStatistics', name: 'overlay' })
})
