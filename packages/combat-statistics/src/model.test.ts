import { expect, it } from 'vitest'
import { defaults, settings } from './model.js'

const old = { quietSeconds: 10, mergePets: true }
it('defaults the parse scope to the own party, including settings saved without a scope', () => {
  expect(defaults.scope).toBe('party')
  expect(settings(old).scope).toBe('party')
})
it.each(['party', 'alliance', 'all'] as const)('accepts the %s scope', (scope) => {
  expect(settings({ ...old, scope })).toEqual({ ...old, scope })
})
it('rejects an unknown scope', () => {
  expect(() => settings({ ...old, scope: 'world' })).toThrow('无效解析范围')
})
it('drops the mode of settings saved before the manual mode was removed', () => {
  expect(settings({ ...defaults, mode: 'manual' })).toEqual(defaults)
})
it.each([
  [{ quietSeconds: 2 }, '脱战判定时间必须为 3～120 秒的整数'],
  [{ quietSeconds: 121 }, '脱战判定时间必须为 3～120 秒的整数'],
  [{ quietSeconds: 10.5 }, '脱战判定时间必须为 3～120 秒的整数'],
  [{ mergePets: 'yes' }, '无效合并宠物设置'],
])('names the invalid item of %o', (patch, error) => {
  expect(() => settings({ ...defaults, ...patch })).toThrow(error)
})
it('rejects a value that is not an object', () => {
  expect(() => settings(null)).toThrow('无效设置')
})
