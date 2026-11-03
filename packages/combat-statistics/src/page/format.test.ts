import { expect, it } from 'vitest'
import { amount, duration, entered, fightCounts, skillName } from './format.js'

it('formats amounts, durations and skill names', () => {
  expect(amount(18_234_567)).toBe('18.2M')
  expect(amount(999_999.4)).toBe('999,999')
  expect(duration(522_900)).toBe('8:42')
  expect(skillName('action:7505', {})).toBe('技能 7505')
  expect(skillName('status:1', { 'status:1': '毒' })).toBe('毒')
  expect(skillName('reflect', {})).toBe('反伤')
})
it('labels the entry time by day', () => {
  const now = new Date(2026, 9, 26, 23, 0).getTime()
  expect(entered(new Date(2026, 9, 26, 20, 5).getTime(), now)).toBe('今天 20:05')
  expect(entered(new Date(2026, 9, 25, 20, 5).getTime(), now)).toBe('昨天 20:05')
  expect(entered(new Date(2026, 9, 24, 8, 5).getTime(), now)).toBe('10月24日 08:05')
})
it('counts fights by result and leaves out results that did not happen', () => {
  const fights = [{ result: 'kill' as const }, ...Array(21).fill({ result: 'wipe' }), { result: null }]
  expect(fightCounts(fights)).toBe('23 场 · 击杀 1 · 团灭 21')
})
