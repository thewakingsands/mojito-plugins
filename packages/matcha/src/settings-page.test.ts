// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'
import html from '../settings.html?raw'
import { defaultSettings } from './settings.js'

const bridge = vi.hoisted(() => ({ command: vi.fn(), snapshot: vi.fn() }))
vi.mock('@ffcafe/mojito-plugin-sdk/view', () => ({ connectView: async () => bridge }))
const button = (id: string) => document.getElementById(id) as HTMLButtonElement
const input = (id: string) => document.getElementById(`field-${id}`) as HTMLInputElement
async function load() {
  await import('./settings-page.js')
  await vi.waitFor(() => expect((document.getElementById('controls') as HTMLFieldSetElement).disabled).toBe(false))
}
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML
  bridge.command.mockImplementation(async (_channel, request) => {
    if (request.action === 'catalog') return { fates: {}, templates: [] }
    if (request.action === 'settings.get') return structuredClone(defaultSettings)
    return null
  })
  bridge.snapshot.mockResolvedValue({ session: { state: 'idle' }, diagnostics: [] })
})

it('keeps one visible panel and supports arrow, home and end navigation', async () => {
  await load()
  const first = button('tab-reminders')
  expect(document.querySelectorAll('[role="tabpanel"]:not([hidden])')).toHaveLength(1)
  first.focus()
  first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
  expect(document.activeElement).toBe(button('tab-diagnostics'))
  expect(button('tab-diagnostics').getAttribute('aria-selected')).toBe('true')
  expect(document.getElementById('panel-reminders')?.hidden).toBe(true)
  button('tab-diagnostics').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
  expect(document.activeElement).toBe(first)
  first.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
  expect(document.activeElement).toBe(button('tab-diagnostics'))
})

it('preserves drafts across categories and saves fields from hidden panels', async () => {
  await load()
  input('output.tts').checked = false
  input('output.tts').dispatchEvent(new Event('change'))
  button('tab-services').click()
  input('universalis.apiKey').value = 'local-test-key'
  input('universalis.apiKey').dispatchEvent(new Event('input'))
  button('tab-data').click()
  button('tab-reminders').click()
  expect(input('output.tts').checked).toBe(false)
  expect(input('universalis.apiKey').value).toBe('local-test-key')
  expect(document.getElementById('dirty')?.textContent).toBe('有未保存的修改')
  document.getElementById('settings-form')!.dispatchEvent(new Event('submit', { cancelable: true }))
  await vi.waitFor(() =>
    expect(bridge.command).toHaveBeenCalledWith('matcha.command', {
      action: 'settings.set',
      settings: expect.objectContaining({
        output: { tts: false, toast: true },
        universalis: expect.objectContaining({ apiKey: 'local-test-key' }),
      }),
    }),
  )
})

it('shows webhook empty state again after deleting the final draft', async () => {
  await load()
  button('tab-services').click()
  expect(document.getElementById('webhook-empty')?.hidden).toBe(false)
  button('webhook-add').click()
  await vi.waitFor(() => expect(document.getElementById('webhook-empty')?.hidden).toBe(true))
  const remove = [...document.querySelectorAll('button')].find((item) => item.textContent === '删除此 Webhook')!
  remove.click()
  expect(document.getElementById('webhook-empty')?.hidden).toBe(false)
})

it('keeps save failures visible outside the selected category', async () => {
  await load()
  button('tab-data').click()
  bridge.command.mockRejectedValueOnce(new Error('保存失败，请重试'))
  document.getElementById('settings-form')!.dispatchEvent(new Event('submit', { cancelable: true }))
  await vi.waitFor(() => expect(document.getElementById('message')?.textContent).toBe('保存失败，请重试'))
  expect(document.getElementById('message')?.closest('[role="tabpanel"]')).toBeNull()
  expect(document.getElementById('message')?.className).toBe('error')
})

it('leaves fields disabled and reports initialization failure', async () => {
  bridge.command.mockRejectedValueOnce(new Error('连接不可用'))
  await import('./settings-page.js')
  await vi.waitFor(() => expect(document.getElementById('connection')?.textContent).toBe('连接失败'))
  expect((document.getElementById('controls') as HTMLFieldSetElement).disabled).toBe(true)
  expect(document.getElementById('message')?.textContent).toBe('连接不可用')
})
