// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { formatUsage, hint, keyInput, MASK } from './page.js'

it('formats the usage', () => {
  expect(formatUsage(null)).toBe('还没有产生费用')
  expect(formatUsage({ chars: 12345, since: '2026-11-15' })).toBe('自 2026-11-15 起：12,345 个计费字符，约 ¥3.70')
})
it('masks a saved key until the field is focused', () => {
  const input = document.createElement('input')
  document.body.append(input)
  const key = keyInput(input)
  key.set(false)
  expect(input.value).toBe('')
  key.set(true)
  expect(input.value).toBe(MASK)
  expect(key.value()).toBe('')
  input.focus()
  expect(input.value).toBe('')
  input.blur()
  expect(input.value).toBe(MASK)
  input.focus()
  input.value = ' sk-new '
  input.blur()
  expect(input.value).toBe(' sk-new ')
  expect(key.value()).toBe('sk-new')
  input.remove()
})
it('opens the hint while the icon is hovered or focused', () => {
  const anchor = document.createElement('span')
  const tip = document.createElement('span')
  let open = false
  vi.spyOn(tip, 'matches').mockImplementation(() => open)
  tip.showPopover = vi.fn(() => {
    open = true
  })
  tip.hidePopover = vi.fn(() => {
    open = false
  })
  hint(anchor, tip)
  anchor.dispatchEvent(new Event('pointerenter'))
  expect(tip.showPopover).toHaveBeenCalledWith({ source: anchor })
  anchor.dispatchEvent(new Event('focus'))
  expect(tip.showPopover).toHaveBeenCalledTimes(1)
  anchor.dispatchEvent(new Event('pointerleave'))
  expect(open).toBe(false)
})
