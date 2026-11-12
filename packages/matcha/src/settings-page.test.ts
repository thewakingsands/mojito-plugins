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
        universalis: true,
      }
    if (request.action === 'settings.get') return structuredClone(defaultSettings)
    if (request.action === 'settings.set') return structuredClone(request.settings)
    return null
  })
  bridge.snapshot.mockResolvedValue({ session: { state: 'idle' }, diagnostics: [] })
})

const saved = () =>
  bridge.command.mock.calls
    .filter(([, request]) => request.action === 'settings.set')
    .map(([, request]) => request.settings)
const lastSaved = () => saved().at(-1)
const fateInput = (id: string) => document.getElementById(id) as HTMLInputElement
const change = (element: HTMLInputElement | HTMLSelectElement) => element.dispatchEvent(new Event('change'))

it('keeps one visible panel and supports arrow, home and end navigation', async () => {
  await load()
  const first = button('tab-notify')
  expect(document.querySelectorAll('[role="tabpanel"]:not([hidden])')).toHaveLength(1)
  first.focus()
  first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
  expect(document.activeElement).toBe(button('tab-data'))
  expect(button('tab-data').getAttribute('aria-selected')).toBe('true')
  expect(document.getElementById('panel-notify')?.hidden).toBe(true)
  button('tab-data').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
  expect(document.activeElement).toBe(first)
  first.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
  expect(document.activeElement).toBe(button('tab-data'))
})

it('saves each change at once, with no draft or save button', async () => {
  await load()
  expect(document.querySelector('[type="submit"]')?.closest('#controls')).toBeNull()
  input('output.tts').checked = false
  change(input('output.tts'))
  await vi.waitFor(() => expect(lastSaved()).toEqual(expect.objectContaining({ output: { tts: false, toast: true } })))
  const language = document.getElementById('field-language') as HTMLSelectElement
  language.value = 'en'
  change(language)
  await vi.waitFor(() => expect(lastSaved()).toEqual(expect.objectContaining({ language: 'en' })))
  expect(lastSaved().output.tts).toBe(false)
})

it('puts the saved value back and shows the reason when a change is rejected', async () => {
  await load()
  bridge.command.mockRejectedValueOnce(new Error('保存失败，请重试'))
  input('formatter.fate.level').checked = true
  change(input('formatter.fate.level'))
  await vi.waitFor(() => expect(document.getElementById('message')?.textContent).toBe('保存失败，请重试'))
  expect(input('formatter.fate.level').checked).toBe(false)
  expect(document.getElementById('message')?.closest('[role="tabpanel"]')).toBeNull()
})

it('leaves fields disabled and reports initialization failure', async () => {
  bridge.command.mockRejectedValueOnce(new Error('连接不可用'))
  await import('./settings-page.js')
  await vi.waitFor(() => expect(document.getElementById('message')?.textContent).toBe('无法连接 Matcha：连接不可用'))
  expect((document.getElementById('controls') as HTMLFieldSetElement).disabled).toBe(true)
})

it('has one switch per online service and no credential or upload fields', async () => {
  await load()
  expect(input('fishing.enabled')).not.toBeNull()
  expect(input('universalis.enabled').disabled).toBe(false)
  expect(input('universalis.apiKey')).toBeNull()
  expect(input('universalis.uploaderId')).toBeNull()
  expect(input('fishing.uploadEnabled')).toBeNull()
  expect(input('telemetry.enabled')).toBeNull()
})

it('turns Universalis off when the build has no credentials', async () => {
  const original = bridge.command.getMockImplementation()
  bridge.command.mockImplementation(async (channel, request) => {
    const result = await original?.(channel, request)
    return request.action === 'catalog' ? { ...result, universalis: false } : result
  })
  await load()
  expect(input('universalis.enabled').disabled).toBe(true)
  expect(document.getElementById('universalis-note')?.textContent).toContain('未配置 Universalis')
})

it('selects versions and zones in bulk and shows partial selection', async () => {
  await load()
  button('tab-fates').click()
  fateInput('fate-version-0').click()
  await vi.waitFor(() => expect(lastSaved()?.watch.fates).toEqual([140]))
  fateInput('fate-version-2').click()
  await vi.waitFor(() => expect(lastSaved()?.watch.fates).toEqual([140, 120, 122, 121]))
  button('fate-version-2-toggle').click()
  fateInput('fate-zone-2-148').click()
  await vi.waitFor(() => expect(lastSaved()?.watch.fates).toEqual([140, 121]))
  expect(fateInput('fate-version-2').indeterminate).toBe(true)
  expect(fateInput('fate-zone-2-149').checked).toBe(true)
  button('fate-zone-2-148-open').click()
  expect(document.getElementById('fate-list-title')?.textContent).toBe('黑衣森林')
  expect(fateInput('fate-120').checked).toBe(false)
  fateInput('fate-120').focus()
  fateInput('fate-120').click()
  await vi.waitFor(() => expect(lastSaved()?.watch.fates).toEqual([140, 121, 120]))
  expect(document.activeElement?.id).toBe('fate-120')
})

it('lists search results, applies bulk choices to them and adds a preset', async () => {
  await load()
  button('tab-fates').click()
  const search = document.getElementById('fate-search') as HTMLInputElement
  search.value = '森林'
  search.dispatchEvent(new Event('input'))
  expect(document.getElementById('fate-list-title')?.textContent).toBe('搜索结果 2 项')
  button('fate-select-all').click()
  await vi.waitFor(() => expect(lastSaved()?.watch.fates).toEqual([120, 122]))
  const preset = document.getElementById('fate-template') as HTMLSelectElement
  preset.value = '0'
  change(preset)
  await vi.waitFor(() => expect(lastSaved()?.watch.fates).toEqual([120, 122, 121, 130]))
  expect(preset.value).toBe('')
  button('fate-clear-all').click()
  await vi.waitFor(() => expect(lastSaved()?.watch.fates).toEqual([121, 130]))
})

it('adds, edits and deletes webhooks through the dialog and checks the headers', async () => {
  await load()
  button('tab-services').click()
  expect(document.getElementById('webhook-rows')?.textContent).toBe('没有 Webhook')
  const dialog = document.getElementById('webhook-dialog') as HTMLDialogElement
  dialog.showModal = vi.fn(() => dialog.setAttribute('open', ''))
  dialog.close = vi.fn(() => dialog.removeAttribute('open'))
  button('webhook-add').click()
  ;(document.getElementById('webhook-name') as HTMLInputElement).value = '部队群'
  ;(document.getElementById('webhook-endpoint') as HTMLInputElement).value = 'https://hooks.example.com/fate'
  ;(document.getElementById('webhook-headers') as HTMLTextAreaElement).value = '{ broken'
  document.getElementById('webhook-form')?.dispatchEvent(new Event('submit', { cancelable: true }))
  await vi.waitFor(() => expect(document.getElementById('webhook-error')?.hidden).toBe(false))
  expect(saved()).toHaveLength(0)
  ;(document.getElementById('webhook-headers') as HTMLTextAreaElement).value = '{ "Authorization": "Bearer x" }'
  document.querySelector<HTMLButtonElement>('#webhook-type [data-value="FORM"]')?.click()
  document.getElementById('webhook-form')?.dispatchEvent(new Event('submit', { cancelable: true }))
  await vi.waitFor(() =>
    expect(lastSaved()?.webhooks).toEqual([
      expect.objectContaining({
        name: '部队群',
        event: 'Fate',
        type: 'FORM',
        endpoint: 'https://hooks.example.com/fate',
        headers: { Authorization: 'Bearer x' },
      }),
    ]),
  )
  const remove = [...document.querySelectorAll('#webhook-rows button')].find((item) => item.textContent === '删除')
  ;(remove as HTMLButtonElement).click()
  await vi.waitFor(() => expect(lastSaved()?.webhooks).toEqual([]))
})

it('replaces the settings on import and can undo it', async () => {
  await load()
  const imported = { ...structuredClone(defaultSettings), language: 'ja', logging: true }
  // The page's own file picker; the test picks the file as the user would
  const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
    Object.defineProperty(this, 'files', {
      value: [new File([JSON.stringify(imported)], 'matcha-settings.json', { type: 'application/json' })],
    })
    this.dispatchEvent(new Event('change'))
  })
  button('tab-data').click()
  expect(button('settings-undo').hidden).toBe(true)
  button('settings-import').click()
  await vi.waitFor(() => expect(lastSaved()).toEqual(expect.objectContaining({ language: 'ja', logging: true })))
  expect(button('settings-undo').hidden).toBe(false)
  button('settings-undo').click()
  await vi.waitFor(() => expect(lastSaved()).toEqual(expect.objectContaining({ language: 'chs', logging: false })))
  expect(button('settings-undo').hidden).toBe(true)
  click.mockRestore()
})

it('allows offline settings while reporting unavailable client tables', async () => {
  const original = bridge.command.getMockImplementation()!
  bridge.command.mockImplementation(async (...args) => {
    const result = await original(...args)
    if (args[1].action === 'catalog')
      return { ...result, fates: {}, templates: [], patches: {}, territories: {}, dataError: '客户端游戏资料暂不可用' }
    return result
  })
  await load()
  expect(document.getElementById('message')?.textContent).toContain('客户端游戏资料暂不可用')
  expect((document.getElementById('controls') as HTMLFieldSetElement).disabled).toBe(false)
})
