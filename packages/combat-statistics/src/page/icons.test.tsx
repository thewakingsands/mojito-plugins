// @vitest-environment jsdom
import type { Value } from '@ffcafe/mojito-plugin-sdk'
import type { ViewBridge } from '@ffcafe/mojito-plugin-sdk/view'
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Command } from '../view-model.js'
import { Bridge } from './bridge.js'
import { SkillIcon } from './icons.js'

const command = async (input: Command): Promise<Value> =>
  input.kind === 'icon' ? ({ mime: 'image/png', data: new Uint8Array([1]) } as unknown as Value) : null
const icon = (skill: string) => (
  <Bridge.Provider value={{ view: {} as ViewBridge, command }}>
    <SkillIcon skill={skill} />
  </Bridge.Provider>
)

beforeEach(() => {
  let count = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:icon-${++count}`)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('draws an icon that has loaded in the first render, and never the icon of the skill before', async () => {
  const first = render(icon('action:1'))
  await waitFor(() => expect(first.container.querySelector('img.icon')).not.toBeNull())
  const url = first.container.querySelector('img.icon')!.getAttribute('src')
  first.unmount()

  const again = render(icon('action:1'))
  expect(again.container.querySelector('img.icon')?.getAttribute('src')).toBe(url)

  again.rerender(icon('action:2'))
  expect(again.container.querySelector('img.icon')).toBeNull()
  await waitFor(() => expect(again.container.querySelector('img.icon')).not.toBeNull())
  expect(again.container.querySelector('img.icon')!.getAttribute('src')).not.toBe(url)
})
