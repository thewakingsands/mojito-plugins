import { expect, it } from 'vitest'
import { billedChars, estimateYuan } from './billing.js'

it('counts Han characters twice and everything else once', () => {
  expect(billedChars('分摊')).toBe(4)
  expect(billedChars('Alice 和')).toBe(8)
  expect(billedChars('')).toBe(0)
})
it('estimates the cost in yuan with two decimals', () => {
  expect(estimateYuan(12345)).toBe('3.70')
  expect(estimateYuan(0)).toBe('0.00')
})
