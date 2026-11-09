// Copyright (c) FFCafe. Licensed under AGPL-3.0-only.
import type { Value } from '@ffcafe/mojito-plugin-sdk'
import { connectView, type ViewBridge } from '@ffcafe/mojito-plugin-sdk/view'
import { defaultSettings, type MatchaSettings, settingsFrom, type Webhook } from './settings.js'
import './settings-page.css'

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
let bridge: ViewBridge
let settings = structuredClone(defaultSettings)
let fates: Record<string, { name: Record<string, string>; level: number }> = {}
let templates: { name: Record<string, string>; fate: number[] }[] = []
let dirty = false
const controls = element<HTMLFieldSetElement>('controls')
const fields = new Map<string, HTMLInputElement | HTMLSelectElement>()
const headers = new Map<string, HTMLTextAreaElement>()

function show(message: string, error = false) {
  const output = element('message')
  output.textContent = message
  output.className = error ? 'error' : ''
}
function markDirty() {
  dirty = true
  element('dirty').textContent = '有未保存的修改'
}
async function command(action: string, data: Record<string, Value> = {}) {
  return bridge.command('matcha.command', { action, ...data })
}
async function perform(task: () => Promise<void>) {
  try {
    await task()
  } catch (error) {
    show(error instanceof Error ? error.message : String(error), true)
  }
}
const name = (value: Record<string, string> | undefined) => value?.[settings.language] || value?.chs || value?.en || ''
function field(section: string, path: string, labelText: string, type: 'checkbox' | 'text' | 'password' = 'checkbox') {
  const label = document.createElement('label')
  const input = document.createElement('input')
  input.type = type
  input.id = `field-${path}`
  input.autocomplete = 'off'
  label.className = type === 'checkbox' ? 'checkbox' : ''
  if (type !== 'checkbox') label.append(document.createTextNode(labelText))
  label.append(input)
  if (type === 'checkbox') label.append(document.createTextNode(labelText))
  input.addEventListener('change', markDirty)
  if (type !== 'checkbox') input.addEventListener('input', markDirty)
  element(section).append(label)
  fields.set(path, input)
}
function buildFields() {
  const label = document.createElement('label')
  label.textContent = '数据语言'
  const language = document.createElement('select')
  for (const [value, title] of [
    ['chs', '简体中文'],
    ['en', 'English'],
    ['ja', '日本語'],
    ['de', 'Deutsch'],
    ['fr', 'Français'],
  ]) {
    language.add(new Option(title, value))
  }
  language.addEventListener('change', () => {
    settings.language = language.value
    markDirty()
    renderFates()
  })
  label.append(language)
  element('general-fields').append(label)
  fields.set('language', language)
  field('general-fields', 'output.tts', '语音播报')
  field('general-fields', 'output.toast', 'Mojito 通知')
  for (const [path, title] of [
    ['fate.name', 'FATE 名称'],
    ['fate.level', 'FATE 等级'],
    ['fate.muteWhileLoading', '地图加载时暂不播报 FATE'],
    ['fish.bite', '鱼咬钩提示'],
    ['fish.biteType', '咬钩强度'],
    ['instance.name', '匹配副本名称'],
    ['instance.level', '匹配副本等级'],
    ['instance.type', '匹配副本类型'],
    ['zone.name', '地图名称'],
    ['zone.instance', '当前副本信息'],
    ['criticalEngagement.name', '临界遭遇名称'],
    ['treasure.result', '寻宝结果'],
  ])
    field('formatter-fields', `formatter.${path}`, title)
  field('fishing-fields', 'fishing.enabled', '启用鱼漂查询')
  field('fishing-fields', 'fishing.uploadEnabled', '允许上传钓鱼数据')
  field('universalis-fields', 'universalis.enabled', '启用 Universalis 服务')
  field('universalis-fields', 'universalis.uploadEnabled', '允许上传市场价格')
  field('universalis-fields', 'universalis.apiKey', 'API 密钥', 'password')
  field('universalis-fields', 'universalis.uploaderId', '上传者标识', 'text')
  field('telemetry-fields', 'telemetry.enabled', '允许上报 FATE 与 NPC 数据')
  field('telemetry-fields', 'telemetry.root', 'HTTPS 服务地址', 'text')
  field('telemetry-fields', 'telemetry.fateBucket', 'FATE 数据桶', 'text')
  field('telemetry-fields', 'telemetry.npcBucket', 'NPC 数据桶', 'text')
  field('telemetry-fields', 'telemetry.clientId', '客户端标识（启用后生成）', 'text')
  ;(fields.get('telemetry.clientId') as HTMLInputElement).readOnly = true
  field('logging-fields', 'logging', '保留本地诊断日志')
}
function property(root: unknown, path: string): { parent: Record<string, unknown>; key: string } {
  const parts = path.split('.')
  let parent = root as Record<string, unknown>
  for (const part of parts.slice(0, -1)) parent = parent[part] as Record<string, unknown>
  return { parent, key: parts.at(-1)! }
}
function collect(): MatchaSettings {
  const draft = structuredClone(settings)
  for (const [path, input] of fields) {
    const { parent, key } = property(draft, path)
    parent[key] = input instanceof HTMLInputElement && input.type === 'checkbox' ? input.checked : input.value
  }
  for (const hook of draft.webhooks) {
    try {
      hook.headers = JSON.parse(headers.get(hook.id)?.value || '{}')
    } catch {
      throw new Error(`Webhook“${hook.name}”的请求头不是有效 JSON。`)
    }
  }
  return settingsFrom(draft)
}
function render() {
  for (const [path, input] of fields) {
    const { parent, key } = property(settings, path)
    if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = Boolean(parent[key])
    else input.value = String(parent[key])
  }
  renderFates()
  headers.clear()
  renderWebhooks()
  element('dirty').textContent = dirty ? '有未保存的修改' : '已与保存的设置同步'
}
function renderFates() {
  const query = element<HTMLInputElement>('fate-search').value.trim().toLocaleLowerCase()
  const results = element('fate-results')
  results.replaceChildren()
  if (query) {
    const matches = Object.entries(fates).filter(
      ([id, value]) =>
        id.includes(query) || Object.values(value.name).some((text) => text.toLocaleLowerCase().includes(query)),
    )
    for (const [id, value] of matches.slice(0, 60)) {
      const row = document.createElement('li')
      row.textContent = `${name(value.name)} · Lv.${value.level} · #${id}`
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = settings.watch.fates.includes(Number(id)) ? '已关注' : '加入'
      button.disabled = settings.watch.fates.includes(Number(id))
      button.addEventListener('click', () => {
        settings.watch.fates.push(Number(id))
        markDirty()
        renderFates()
      })
      row.append(button)
      results.append(row)
    }
    if (matches.length === 0) {
      const row = document.createElement('li')
      row.textContent = '没有匹配的 FATE'
      results.append(row)
    }
  }
  const selected = element('fate-selected')
  selected.replaceChildren()
  for (const id of settings.watch.fates) {
    const row = document.createElement('li')
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = `${name(fates[id]?.name) || `FATE #${id}`} ×`
    button.title = '从关注列表移除'
    button.addEventListener('click', () => {
      settings.watch.fates = settings.watch.fates.filter((value) => value !== id)
      markDirty()
      renderFates()
    })
    row.append(button)
    selected.append(row)
  }
  element('fate-count').textContent = `已关注 ${settings.watch.fates.length} 项${query ? ' · 搜索最多显示 60 项' : ''}`
}
function renderWebhooks() {
  const pendingHeaders = new Map([...headers].map(([id, input]) => [id, input.value]))
  const container = element('webhook-rows')
  container.replaceChildren()
  headers.clear()
  for (const hook of settings.webhooks) {
    const group = document.createElement('fieldset')
    group.className = 'webhook'
    const legend = document.createElement('legend')
    legend.textContent = hook.name || 'Webhook'
    group.append(legend)
    const grid = document.createElement('div')
    grid.className = 'fields'
    group.append(grid)
    for (const [key, title] of [
      ['name', '名称'],
      ['event', '事件（例如 Fate、Fishing、MarketBoardItemListing）'],
      ['endpoint', 'HTTPS 地址'],
    ] as const) {
      const label = document.createElement('label')
      label.textContent = title
      const input = document.createElement('input')
      input.type = 'text'
      input.value = hook[key]
      input.addEventListener('input', () => {
        hook[key] = input.value
        markDirty()
      })
      label.append(input)
      grid.append(label)
    }
    const typeLabel = document.createElement('label')
    typeLabel.textContent = '请求格式'
    const type = document.createElement('select')
    for (const item of ['GET', 'JSON', 'FORM', 'MULTIPART']) type.add(new Option(item, item))
    type.value = hook.type
    type.addEventListener('change', () => {
      hook.type = type.value as Webhook['type']
      markDirty()
    })
    typeLabel.append(type)
    grid.append(typeLabel)
    const label = document.createElement('label')
    label.textContent = '请求头（JSON 对象，可包含密钥）'
    const input = document.createElement('textarea')
    input.value = pendingHeaders.get(hook.id) ?? JSON.stringify(hook.headers, null, 2)
    input.addEventListener('input', markDirty)
    headers.set(hook.id, input)
    label.append(input)
    group.append(label)
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.textContent = '删除此 Webhook'
    remove.addEventListener('click', () => {
      settings.webhooks = settings.webhooks.filter((value) => value.id !== hook.id)
      headers.delete(hook.id)
      group.remove()
      markDirty()
    })
    group.append(remove)
    container.append(group)
  }
}
async function reload() {
  settings = settingsFrom(await command('settings.get'))
  dirty = false
  render()
  show('设置已载入。')
}
async function diagnostics() {
  const state = await bridge.snapshot('matcha.state')
  const record = state && typeof state === 'object' ? (state as Record<string, Value>) : {}
  element('session').textContent = `当前会话：${JSON.stringify(record.session ?? null)}`
  const list = element('diagnostics')
  list.replaceChildren()
  for (const entry of Array.isArray(record.diagnostics) ? record.diagnostics : []) {
    const row = document.createElement('li')
    row.textContent = typeof entry === 'string' ? entry : JSON.stringify(entry)
    list.append(row)
  }
  if (!list.childNodes.length) {
    const row = document.createElement('li')
    row.textContent = '暂无诊断消息。'
    list.append(row)
  }
}
function click(id: string, action: () => Promise<void> | void) {
  element(id).addEventListener('click', () => {
    void perform(async () => {
      await action()
    })
  })
}
async function initialize() {
  buildFields()
  bridge = await connectView()
  const catalog = (await command('catalog')) as { fates: typeof fates; templates: typeof templates }
  fates = catalog.fates
  templates = catalog.templates
  const select = element<HTMLSelectElement>('fate-template')
  templates.forEach((template, index) => {
    select.add(new Option(name(template.name), String(index)))
  })
  await reload()
  await diagnostics()
  controls.disabled = false
  element<HTMLButtonElement>('diagnostics-refresh').disabled = false
  element('connection').textContent = 'Mojito 已连接'
  element('fate-search').addEventListener('input', renderFates)
  element('settings-form').addEventListener('submit', (event) => {
    event.preventDefault()
    void perform(async () => {
      await command('settings.set', { settings: collect() as unknown as Value })
      await reload()
      await diagnostics()
      show('设置已保存。')
    })
  })
  click('reload', reload)
  click('diagnostics-refresh', diagnostics)
  click('test-notification', async () => {
    await command('test.notification')
    show('已请求测试通知，请确认语音和Mojito 通知。')
    await diagnostics()
  })
  click('apply-template', () => {
    const template = select.value === '' ? undefined : templates[Number(select.value)]
    if (!template) return
    settings.watch.fates = [...new Set([...settings.watch.fates, ...template.fate])]
    markDirty()
    renderFates()
  })
  click('watch-clear', () => {
    settings.watch.fates = []
    markDirty()
    renderFates()
  })
  click('watch-import', async () => {
    const result = await command('watch.import')
    if (result === null) return
    settings.watch.fates = settingsFrom({ watch: { fates: result } }).watch.fates
    markDirty()
    renderFates()
    show('关注列表已导入草稿，保存后生效。')
  })
  click('watch-export', async () => {
    const saved = await command('watch.export', { fates: settings.watch.fates })
    show(saved ? '关注列表已导出。' : '已取消导出。')
  })
  click('webhook-add', () => {
    if (settings.webhooks.length >= 32) throw new Error('最多添加 32 条 Webhook。')
    settings.webhooks.push({
      id: crypto.randomUUID(),
      name: '',
      event: 'Fate',
      type: 'JSON',
      endpoint: 'https://',
      headers: {},
    })
    markDirty()
    renderWebhooks()
  })
  click('settings-import', async () => {
    const result = await command('file.read', { extensions: ['json'] })
    if (result === null) return
    if (!result || typeof result !== 'object' || !('bytes' in result) || !(result.bytes instanceof Uint8Array))
      throw new Error('文件响应无效。')
    settings = settingsFrom(JSON.parse(new TextDecoder().decode(result.bytes)))
    markDirty()
    render()
    show('设置已导入草稿，请检查联网与上传开关，再保存。')
  })
  click('settings-export', async () => {
    const saved = await command('file.write', {
      name: 'matcha-settings.json',
      bytes: new TextEncoder().encode(JSON.stringify(collect(), null, 2)),
    })
    show(saved ? '设置备份已导出，包含 API 密钥和 Webhook 请求头，请妥善保存。' : '已取消导出。')
  })
  click('notebook-export', async () => {
    const saved = await command('notebook.export')
    show(saved ? '钓鱼图鉴已导出。' : '已取消导出。')
  })
}
void initialize().catch((error: unknown) => {
  element('connection').textContent = '连接失败'
  show(error instanceof Error ? error.message : String(error), true)
})
