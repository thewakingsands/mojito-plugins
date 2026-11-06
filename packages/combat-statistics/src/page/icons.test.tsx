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
  vi.useRealTimers()
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

it('draws every icon of a review that asks for more than the host takes at once', async () => {
  // The host rejects calls of a plugin beyond 128 at a time; even keys answer fast, as icons on disk do.
  let running = 0
  const limited = async (input: Command): Promise<Value> => {
    if (running >= 128) throw { code: 'quota_exceeded' }
    running++
    try {
      const id = Number((input as { key: string }).key.split(':')[1])
      await new Promise((resolve) => setTimeout(resolve, id % 2 ? 20 : 1))
      return { mime: 'image/png', data: new Uint8Array([1]) } as unknown as Value
    } finally {
      running--
    }
  }
  const view = render(
    <Bridge.Provider value={{ view: {} as ViewBridge, command: limited }}>
      {Array.from({ length: 300 }, (_, i) => (
        <SkillIcon key={i} skill={`action:${5001 + i}`} />
      ))}
    </Bridge.Provider>,
  )
  await waitFor(() => expect(view.container.querySelectorAll('img.icon')).toHaveLength(300), { timeout: 3000 })
})

const png = { mime: 'image/png', data: new Uint8Array([1]) } as unknown as Value
const icons = (run: (input: Command) => Promise<Value>, skills: string[]) => (
  <Bridge.Provider value={{ view: {} as ViewBridge, command: run }}>
    {skills.map((skill, i) => (
      <SkillIcon key={i} skill={skill} />
    ))}
  </Bridge.Provider>
)
/** A command that answers each call with the next of the outcomes, the last one repeating */
function scripted(...outcomes: ('icon' | 'none' | string)[]) {
  const run = vi.fn(async (_input: Command): Promise<Value> => {
    const outcome = outcomes[Math.min(run.mock.calls.length - 1, outcomes.length - 1)]
    if (outcome === 'icon') return png
    if (outcome === 'none') return null
    throw { code: outcome }
  })
  return run
}
const shown = (view: { container: HTMLElement }) => view.container.querySelectorAll('img.icon').length

it('sends at most eight icon commands at a time', async () => {
  let running = 0
  let most = 0
  const run = vi.fn(async (_input: Command): Promise<Value> => {
    most = Math.max(most, ++running)
    await new Promise((resolve) => setTimeout(resolve, 1))
    running--
    return png
  })
  const view = render(
    icons(
      run,
      Array.from({ length: 300 }, (_, i) => `action:${6001 + i}`),
    ),
  )
  await waitFor(() => expect(shown(view)).toBe(300), { timeout: 3000 })
  expect(most).toBeLessThanOrEqual(8)
  expect(run).toHaveBeenCalledTimes(300)
})

it('asks again five seconds after a request fails', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const run = scripted('quota_exceeded', 'icon')
  const view = render(icons(run, ['action:7001']))
  await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
  expect(shown(view)).toBe(0)
  await vi.advanceTimersByTimeAsync(5000)
  await waitFor(() => expect(shown(view)).toBe(1))
  expect(run).toHaveBeenCalledTimes(2)
})

it('keeps asking while the game data stays unavailable', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const run = scripted('unavailable', 'unavailable', 'unavailable', 'icon')
  const view = render(icons(run, ['action:7101']))
  await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
  for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(5000)
  await waitFor(() => expect(shown(view)).toBe(1))
  expect(run).toHaveBeenCalledTimes(4)
})

it('never asks again for an icon the game data lacks', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const run = scripted('none')
  const first = render(icons(run, ['action:7201']))
  await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
  await vi.advanceTimersByTimeAsync(15000)
  expect(run).toHaveBeenCalledTimes(1)
  first.unmount()
  render(icons(run, ['action:7201']))
  await vi.advanceTimersByTimeAsync(5000)
  expect(run).toHaveBeenCalledTimes(1)
})

it('stops asking once the icon is no longer shown', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const run = scripted('unavailable')
  const view = render(icons(run, ['action:7301']))
  await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
  view.unmount()
  await vi.advanceTimersByTimeAsync(15000)
  expect(run).toHaveBeenCalledTimes(1)
})

it('shares one request among the icons of the same key', async () => {
  const run = scripted('icon')
  const view = render(
    icons(
      run,
      Array.from({ length: 5 }, () => 'action:7401'),
    ),
  )
  await waitFor(() => expect(shown(view)).toBe(5))
  expect(run).toHaveBeenCalledTimes(1)
})
