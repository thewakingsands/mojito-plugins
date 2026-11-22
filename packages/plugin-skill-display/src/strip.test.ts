// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { strip } from './page.js'
import type { Action, Settings } from './state.js'

const settings: Settings = { seconds: 10, scale: 100, newest: 'right' }
const action: Action = { key: '1:1', id: 20, at: 1000, name: 'Action', gcd: true, icon: 58 }

it('asks again for an icon that could not be read', async () => {
  const icon = vi
    .fn<(id: number) => Promise<string | null>>()
    .mockResolvedValueOnce(null)
    .mockResolvedValue('blob:icon')
  const root = document.createElement('div')
  document.body.append(root)
  const display = strip(root, icon)
  display.update([action], settings, 'resources')
  await Promise.resolve()
  expect(root.querySelector('img')).toBeNull()
  // The next state carries the same action: its icon is requested once more.
  display.update([action], settings, 'resources')
  await Promise.resolve()
  expect(icon).toHaveBeenCalledTimes(2)
  expect(root.querySelector('img')?.getAttribute('src')).toBe('blob:icon')
})
