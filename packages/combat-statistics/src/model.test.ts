import { expect, it } from 'vitest'
import { defaults, settings } from './model.js'

const old = { mode: 'auto', quietSeconds: 10, mergePets: true }
it('defaults the parse scope to the own party, including settings saved without a scope', () => {
  expect(defaults.scope).toBe('party')
  expect(settings(old).scope).toBe('party')
})
it.each(['party', 'alliance', 'all'] as const)('accepts the %s scope', (scope) => {
  expect(settings({ ...old, scope })).toEqual({ ...old, scope, telemetryEnabled: false })
})
it('rejects an unknown scope', () => {
  expect(() => settings({ ...old, scope: 'world' })).toThrow('无效解析范围')
})

it('keeps anonymous sampling off for old settings and rejects invalid consent', () => {
  expect(settings(old).telemetryEnabled).toBe(false)
  expect(settings({ ...old, telemetryEnabled: true }).telemetryEnabled).toBe(true)
  expect(() => settings({ ...old, telemetryEnabled: 'yes' })).toThrow()
})
