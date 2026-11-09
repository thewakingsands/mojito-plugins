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
    if (request.action === 'catalog')
      return {
        fates: {
          120: { name: { chs: '森林一' }, level: 5, patch: 2, location: 148 },
          121: { name: { chs: '沙漠' }, level: 6, patch: 2, location: 149 },
          122: { name: { chs: '森林二' }, level: 7, patch: 2, location: 148 },
          130: { name: { chs: '高原' }, level: 50, patch: 3, location: 400 },
          140: { name: { chs: '未知地区事件' }, level: 10, patch: 2, location: 0 },
        },
        patches: { 2: { chs: '重生之境' }, 3: { chs: '苍穹之禁城' } },
        territories: { 148: { chs: '黑衣森林' }, 149: { chs: '萨纳兰' }, 400: { chs: '高原' } },
        templates: [{ name: { chs: '预设一' }, fate: [121, 130] }],
      }
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

it('has one switch per online service and no FATE or NPC upload settings', async () => {
  await load()
  expect(input('fishing.enabled')).not.toBeNull()
  expect(input('universalis.enabled')).not.toBeNull()
  expect(input('fishing.uploadEnabled')).toBeNull()
  expect(input('universalis.uploadEnabled')).toBeNull()
  expect(input('telemetry.enabled')).toBeNull()
})

const fateInput = (id: string) => document.getElementById(id) as HTMLInputElement
it('selects versions and regions in bulk, preserves other groups and shows partial selection', async () => {
  await load()
  button('tab-fates').click()
  fateInput('fate-140').click()
  fateInput('fate-version-2-select').click()
  expect(fateInput('fate-120').checked).toBe(true)
  expect(fateInput('fate-121').checked).toBe(true)
  expect(fateInput('fate-122').checked).toBe(true)
  expect(fateInput('fate-130').checked).toBe(false)
  fateInput('fate-region-2-148-select').click()
  expect(fateInput('fate-120').checked).toBe(false)
  expect(fateInput('fate-122').checked).toBe(false)
  expect(fateInput('fate-121').checked).toBe(true)
  expect(fateInput('fate-140').checked).toBe(true)
  expect(fateInput('fate-version-2-select').indeterminate).toBe(true)
  fateInput('fate-region-3-400-select').click()
  document.getElementById('settings-form')!.dispatchEvent(new Event('submit', { cancelable: true }))
  await vi.waitFor(() =>
    expect(bridge.command).toHaveBeenCalledWith('matcha.command', {
      action: 'settings.set',
      settings: expect.objectContaining({ watch: { fates: [140, 121, 130] } }),
    }),
  )
})

it('synchronizes search choices with the tree and applies a preset independently', async () => {
  await load()
  button('tab-fates').click()
  const search = document.getElementById('fate-search') as HTMLInputElement
  search.value = '森林'
  search.dispatchEvent(new Event('input'))
  button('fate-search-select').click()
  expect(fateInput('fate-region-2-148-select').checked).toBe(true)
  expect(fateInput('fate-result-120').closest('li')?.hasAttribute('data-selected')).toBe(true)
  fateInput('fate-result-120').focus()
  fateInput('fate-result-120').click()
  expect(document.activeElement?.id).toBe('fate-result-120')
  expect(fateInput('fate-120').checked).toBe(false)
  expect(fateInput('fate-region-2-148-select').indeterminate).toBe(true)
  const preset = document.getElementById('fate-template') as HTMLSelectElement
  preset.value = '0'
  preset.dispatchEvent(new Event('change'))
  expect(fateInput('fate-121').checked).toBe(false)
  button('apply-template').click()
  expect(fateInput('fate-121').checked).toBe(true)
  expect(fateInput('fate-130').checked).toBe(true)
  expect(fateInput('fate-122').checked).toBe(true)
  expect(search.value).toBe('森林')
  button('fate-search-clear').click()
  expect(fateInput('fate-122').checked).toBe(false)
  expect(fateInput('fate-121').checked).toBe(true)
  expect(fateInput('fate-130').checked).toBe(true)
})
