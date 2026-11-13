// Copyright (c) FFCafe. Licensed under AGPL-3.0-only.
import type { Value } from '@ffcafe/mojito-plugin-sdk'
import { connectView, type ViewBridge } from '@ffcafe/mojito-plugin-sdk/view'
import { defaultSettings, type MatchaSettings, settingsFrom, type Webhook, webhookEvents } from './settings.js'
import './settings-page.css'

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
let bridge: ViewBridge
let settings = structuredClone(defaultSettings)
type Names = Record<string, string>
let fates: Record<string, { name: Names; level: number; patch: number; location: number }> = {}
let patches: Record<string, Names> = {}
let territories: Record<string, Names> = {}
let templates: { name: Names; fate: number[] }[] = []
/** The settings before the last import, kept until the page is left so the import can be undone */
let beforeImport: MatchaSettings | null = null
const fields = new Map<string, HTMLInputElement | HTMLSelectElement>()

const formatters: [section: string, path: string, title: string, help?: string][] = [
  ['formatter-fate', 'fate.name', 'FATE 名称'],
  ['formatter-fate', 'fate.level', 'FATE 等级'],
  ['formatter-fate', 'fate.muteWhileLoading', '地图加载时暂不播报', '切换地图时不播报已经在进行的 FATE。'],
  ['formatter-world', 'instance.name', '匹配副本名称'],
  ['formatter-world', 'instance.level', '匹配副本等级'],
  ['formatter-world', 'instance.type', '匹配副本类型'],
  ['formatter-world', 'zone.name', '地图名称'],
  ['formatter-world', 'zone.instance', '当前副本信息'],
  ['formatter-world', 'criticalEngagement.name', '临界遭遇名称'],
  ['formatter-other', 'fish.bite', '鱼咬钩提示'],
  ['formatter-other', 'fish.biteType', '咬钩强度'],
  ['formatter-other', 'treasure.result', '寻宝结果'],
]

let messageTimer: ReturnType<typeof setTimeout> | undefined
/** One line under the tabs: errors stay until the next action, confirmations fade after a few seconds */
function show(message: string, error = false) {
  const output = element('message')
  clearTimeout(messageTimer)
  output.textContent = message
  output.hidden = !message
  output.className = error ? 'mojito-callout' : 'confirmation'
  if (error) output.dataset.tone = 'danger'
  else delete output.dataset.tone
  if (message && !error) messageTimer = setTimeout(() => show(''), 4000)
}
async function command(action: string, data: Record<string, Value> = {}) {
  return bridge.command('matcha.command', { action, ...data })
}
/** A JSON file the user picks with the page's own file picker; null when the picker is closed */
function pickFile(): Promise<Uint8Array | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (!file) resolve(null)
      else file.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject)
    })
    input.addEventListener('cancel', () => resolve(null))
    input.click()
  })
}
/** Offers bytes as a download; Mojito asks where to save it */
function download(name: string, bytes: Value) {
  if (!(bytes instanceof Uint8Array)) throw new Error('文件响应无效')
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
async function perform(task: () => Promise<void>) {
  try {
    await task()
  } catch (error) {
    show(error instanceof Error ? error.message : String(error), true)
  }
}
const name = (value: Names | undefined) =>
  value?.[settings.language] || value?.chs || value?.en || Object.values(value ?? {}).find(Boolean) || ''

/** Every change takes effect at once, as in Mojito's own settings; a rejected change puts the saved value back */
let saving = Promise.resolve()
function save(next: MatchaSettings) {
  const previous = settings
  settings = next
  saving = saving.then(() =>
    perform(async () => {
      try {
        settings = settingsFrom(await command('settings.set', { settings: next as unknown as Value }))
      } catch (error) {
        settings = previous
        throw error
      } finally {
        render()
      }
    }),
  )
  return saving
}
function property(root: unknown, path: string): { parent: Record<string, unknown>; key: string } {
  const parts = path.split('.')
  let parent = root as Record<string, unknown>
  for (const part of parts.slice(0, -1)) parent = parent[part] as Record<string, unknown>
  return { parent, key: parts.at(-1) as string }
}
function switchRow(path: string, title: string, help?: string) {
  const row = document.createElement('div')
  row.className = 'mojito-field'
  const text = document.createElement('div')
  const label = document.createElement('label')
  label.htmlFor = `field-${path}`
  label.textContent = title
  text.append(label)
  if (help) {
    const small = document.createElement('small')
    small.textContent = help
    text.append(small)
  }
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.setAttribute('role', 'switch')
  input.id = `field-${path}`
  input.dataset.path = path
  row.append(text, input)
  return row
}
function buildFields() {
  const prepend = (section: string, ...rows: HTMLElement[]) => element(section).prepend(...rows)
  prepend(
    'output-fields',
    switchRow('output.tts', '语音播报'),
    switchRow('output.toast', 'Mojito 通知', '在 Mojito 的通知列表里显示提醒。'),
  )
  prepend(
    'fishing-fields',
    switchRow('fishing.enabled', '启用', '查询社区的咬钩区间，并上传钓鱼数据。关闭后仍保留本地记录和手动设置的区间。'),
  )
  prepend('universalis-fields', switchRow('universalis.enabled', '启用', '查询在线物价，并上传在市场板看到的价格。'))
  element('universalis-fields').querySelector('small')?.setAttribute('id', 'universalis-note')
  prepend('diagnostics-fields', switchRow('logging', '保留诊断日志'))
  for (const [section, path, title, help] of formatters)
    element(section).append(switchRow(`formatter.${path}`, title, help))
  for (const input of document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-path]')) {
    const path = input.dataset.path as string
    fields.set(path, input)
    input.addEventListener('change', () => {
      const next = structuredClone(settings)
      const { parent, key } = property(next, path)
      parent[key] = input instanceof HTMLInputElement && input.type === 'checkbox' ? input.checked : input.value
      void save(next)
    })
  }
}
function render() {
  // Rows are rebuilt after each change; keep keyboard focus where it was
  const focused = document.activeElement?.id
  for (const [path, input] of fields) {
    const { parent, key } = property(settings, path)
    if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = Boolean(parent[key])
    else input.value = String(parent[key])
  }
  renderFateTree()
  renderFateList()
  renderTemplates()
  renderWebhooks()
  if (focused && document.activeElement?.id !== focused)
    document.getElementById(focused)?.focus({ preventScroll: true })
}

/* FATE 关注: versions and zones on the left, the FATEs of the chosen zone (or the search results) on the right */
let selectedZone: string | null = null
const expandedVersions = new Set<number>()
function fateIndex() {
  const versions = new Map<number, Map<number, number[]>>()
  for (const [id, item] of Object.entries(fates)) {
    const patch = item.location === 0 ? 0 : item.patch
    const zones = versions.get(patch) ?? new Map<number, number[]>()
    const ids = zones.get(item.location) ?? []
    ids.push(Number(id))
    zones.set(item.location, ids)
    versions.set(patch, zones)
  }
  return [...versions].sort(([a], [b]) => a - b)
}
function updateWatch(ids: number[], checked: boolean) {
  const selected = new Set(settings.watch.fates)
  for (const id of ids) {
    if (checked) selected.add(id)
    else selected.delete(id)
  }
  const next = structuredClone(settings)
  next.watch.fates = [...selected]
  void save(next)
}
function checkbox(ids: number[], label: string, id: string) {
  const watched = new Set(settings.watch.fates)
  const selected = ids.filter((id) => watched.has(id)).length
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.id = id
  input.checked = selected === ids.length && ids.length > 0
  input.indeterminate = selected > 0 && selected < ids.length
  input.setAttribute('aria-label', label)
  input.addEventListener('click', (event) => event.stopPropagation())
  input.addEventListener('change', () => updateWatch(ids, input.checked))
  const count = document.createElement('span')
  count.className = 'count'
  count.textContent = `${selected} / ${ids.length}`
  return { input, count }
}
function renderFateTree() {
  const tree = element('fate-tree')
  tree.replaceChildren()
  for (const [patch, zones] of fateIndex()) {
    const title = patch === 0 ? '未知地区' : `${patch}.0 ${name(patches[patch])}`
    const all = [...zones.values()].flat()
    const expanded = expandedVersions.has(patch)
    const row = document.createElement('div')
    row.className = 'tree-row version'
    const toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.className = 'tree-toggle'
    toggle.id = `fate-version-${patch}-toggle`
    toggle.setAttribute('aria-expanded', String(expanded))
    toggle.innerHTML = '<span class="mojito-chevron"></span>'
    toggle.setAttribute('aria-label', expanded ? `收起 ${title}` : `展开 ${title}`)
    const { input, count } = checkbox(all, title, `fate-version-${patch}`)
    const text = document.createElement('span')
    text.className = 'tree-name'
    text.textContent = title
    row.append(toggle, input, text, count)
    const open = () => {
      if (patch === 0) {
        selectedZone = '0:0'
        renderFateTree()
        renderFateList()
        return
      }
      if (expanded) expandedVersions.delete(patch)
      else expandedVersions.add(patch)
      renderFateTree()
    }
    toggle.addEventListener('click', open)
    text.addEventListener('click', open)
    if (patch === 0) row.toggleAttribute('data-selected', selectedZone === '0:0')
    tree.append(row)
    if (!expanded || patch === 0) continue
    for (const [zone, ids] of zones) {
      const key = `${patch}:${zone}`
      const zoneTitle = name(territories[zone]) || `区域 #${zone}`
      const zoneRow = document.createElement('div')
      zoneRow.className = 'tree-row zone'
      zoneRow.toggleAttribute('data-selected', selectedZone === key)
      const box = checkbox(ids, zoneTitle, `fate-zone-${patch}-${zone}`)
      const zoneText = document.createElement('button')
      zoneText.type = 'button'
      zoneText.className = 'tree-name'
      zoneText.id = `fate-zone-${patch}-${zone}-open`
      zoneText.textContent = zoneTitle
      zoneText.addEventListener('click', () => {
        selectedZone = key
        element<HTMLInputElement>('fate-search').value = ''
        renderFateTree()
        renderFateList()
      })
      zoneRow.append(box.input, zoneText, box.count)
      tree.append(zoneRow)
    }
  }
}
function listedFates(): { title: string; ids: number[]; limited: boolean } {
  const query = element<HTMLInputElement>('fate-search').value.trim().toLocaleLowerCase()
  if (query) {
    const ids = Object.entries(fates)
      .filter(
        ([id, value]) =>
          id.includes(query) || Object.values(value.name).some((text) => text.toLocaleLowerCase().includes(query)),
      )
      .map(([id]) => Number(id))
    return { title: `搜索结果 ${ids.length} 项`, ids, limited: ids.length > 200 }
  }
  if (!selectedZone) return { title: '选择左侧的区域', ids: [], limited: false }
  const [patch, zone] = selectedZone.split(':').map(Number)
  const ids = Object.entries(fates)
    .filter(([, item]) => (item.location === 0 ? 0 : item.patch) === patch && item.location === zone)
    .map(([id]) => Number(id))
  return { title: zone === 0 ? '未知地区' : name(territories[zone]) || `区域 #${zone}`, ids, limited: false }
}
function renderFateList() {
  const { title, ids, limited } = listedFates()
  element('fate-list-title').textContent = title
  element<HTMLButtonElement>('fate-select-all').disabled = ids.length === 0
  element<HTMLButtonElement>('fate-clear-all').disabled = ids.length === 0
  element('fate-count').textContent = `已关注 ${settings.watch.fates.length} 项`
  const list = element('fate-list')
  list.replaceChildren()
  const watched = new Set(settings.watch.fates)
  for (const id of ids.slice(0, 200)) {
    const item = fates[id]
    const row = document.createElement('li')
    const label = document.createElement('label')
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.id = `fate-${id}`
    input.checked = watched.has(id)
    input.addEventListener('change', () => updateWatch([id], input.checked))
    const text = document.createElement('span')
    text.className = 'fate-name'
    text.textContent = name(item.name)
    const meta = document.createElement('span')
    meta.className = 'fate-meta'
    meta.textContent = `Lv.${item.level} · #${id}`
    label.append(input, text, meta)
    row.append(label)
    list.append(row)
  }
  if (ids.length === 0) {
    const row = document.createElement('li')
    row.className = 'mojito-empty'
    row.textContent = element<HTMLInputElement>('fate-search').value.trim()
      ? '没有匹配的 FATE'
      : '在左侧选择区域，或在上方搜索 FATE'
    list.append(row)
  } else if (limited) {
    const row = document.createElement('li')
    row.className = 'mojito-empty'
    row.textContent = `只列出前 200 项；“全部关注”“全部取消”作用于全部 ${ids.length} 项`
    list.append(row)
  }
}
function renderTemplates() {
  const select = element<HTMLSelectElement>('fate-template')
  select.replaceChildren(new Option('从预设加入…', ''))
  templates.forEach((template, index) => {
    select.add(new Option(name(template.name), String(index)))
  })
}

/* Webhook: one row each; adding and editing happen in a dialog */
const webhookLabels = new Map(webhookEvents.map(([event, label]) => [event, label]))
function renderWebhooks() {
  const container = element('webhook-rows')
  container.replaceChildren()
  if (settings.webhooks.length === 0) {
    const empty = document.createElement('li')
    empty.className = 'mojito-empty'
    empty.textContent = '没有 Webhook'
    container.append(empty)
    return
  }
  for (const hook of settings.webhooks) {
    const row = document.createElement('li')
    row.className = 'webhook'
    const text = document.createElement('div')
    text.className = 'webhook-text'
    const title = document.createElement('div')
    title.className = 'webhook-name'
    title.textContent = hook.name || '未命名'
    const meta = document.createElement('div')
    meta.className = 'webhook-meta'
    for (const value of [webhookLabels.get(hook.event) ?? hook.event, hook.type]) {
      const chip = document.createElement('span')
      chip.className = 'mojito-chip'
      chip.dataset.mark = 'none'
      chip.textContent = value
      meta.append(chip)
    }
    const endpoint = document.createElement('code')
    endpoint.textContent = hook.endpoint
    meta.append(endpoint)
    text.append(title, meta)
    const edit = document.createElement('button')
    edit.type = 'button'
    edit.dataset.variant = 'ghost'
    edit.textContent = '编辑'
    edit.addEventListener('click', () => openWebhook(hook))
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.dataset.variant = 'ghost'
    remove.textContent = '删除'
    remove.addEventListener('click', () => {
      const next = structuredClone(settings)
      next.webhooks = next.webhooks.filter((value) => value.id !== hook.id)
      void save(next)
    })
    row.append(text, edit, remove)
    container.append(row)
  }
}
let editing: Webhook | null = null
function webhookType(value?: Webhook['type']) {
  const buttons = [...element('webhook-type').querySelectorAll<HTMLButtonElement>('button')]
  if (value) for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.value === value))
  return (buttons.find((button) => button.getAttribute('aria-pressed') === 'true')?.dataset.value ??
    'JSON') as Webhook['type']
}
function openWebhook(hook: Webhook | null) {
  editing = hook
  element('webhook-title').textContent = hook ? '编辑 Webhook' : '添加 Webhook'
  element<HTMLInputElement>('webhook-name').value = hook?.name ?? ''
  element<HTMLSelectElement>('webhook-event').value = hook?.event ?? 'Fate'
  element<HTMLInputElement>('webhook-endpoint').value = hook?.endpoint ?? ''
  webhookType(hook?.type ?? 'JSON')
  element<HTMLTextAreaElement>('webhook-headers').value =
    hook && Object.keys(hook.headers).length ? JSON.stringify(hook.headers, null, 2) : ''
  element('webhook-error').hidden = true
  element<HTMLDialogElement>('webhook-dialog').showModal()
}
async function submitWebhook() {
  const error = element('webhook-error')
  try {
    const text = element<HTMLTextAreaElement>('webhook-headers').value.trim()
    let headers: Record<string, string> = {}
    if (text) {
      try {
        headers = JSON.parse(text)
      } catch {
        throw new Error('请求头不是有效的 JSON 对象')
      }
    }
    const hook: Webhook = {
      id: editing?.id ?? crypto.randomUUID(),
      name: element<HTMLInputElement>('webhook-name').value.trim(),
      event: element<HTMLSelectElement>('webhook-event').value,
      type: webhookType(),
      endpoint: element<HTMLInputElement>('webhook-endpoint').value.trim(),
      headers,
    }
    const next = structuredClone(settings)
    if (editing) next.webhooks = next.webhooks.map((value) => (value.id === hook.id ? hook : value))
    else {
      if (next.webhooks.length >= 32) throw new Error('最多添加 32 条 Webhook')
      next.webhooks.push(hook)
    }
    const checked = settingsFrom(next)
    element<HTMLDialogElement>('webhook-dialog').close()
    await save(checked)
  } catch (reason) {
    error.textContent = reason instanceof Error ? reason.message : String(reason)
    error.hidden = false
  }
}

async function reload() {
  settings = settingsFrom(await command('settings.get'))
  render()
}
async function diagnostics() {
  const state = await bridge.snapshot('matcha.state')
  const record = state && typeof state === 'object' ? (state as Record<string, Value>) : {}
  element('session').textContent = JSON.stringify(record.session ?? null, null, 2)
  const list = element('diagnostics')
  list.replaceChildren()
  for (const entry of Array.isArray(record.diagnostics) ? record.diagnostics : []) {
    const row = document.createElement('li')
    row.textContent = typeof entry === 'string' ? entry : JSON.stringify(entry)
    list.append(row)
  }
  if (!list.childNodes.length) {
    const row = document.createElement('li')
    row.className = 'empty'
    row.textContent = '暂无诊断消息'
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
function initializeTabs() {
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
  const select = (tab: HTMLButtonElement) => {
    for (const item of tabs) {
      const selected = item === tab
      item.setAttribute('aria-selected', String(selected))
      item.tabIndex = selected ? 0 : -1
      element(item.getAttribute('aria-controls') as string).hidden = !selected
    }
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(tab))
    tab.addEventListener('keydown', (event) => {
      const next =
        event.key === 'ArrowRight'
          ? (index + 1) % tabs.length
          : event.key === 'ArrowLeft'
            ? (index + tabs.length - 1) % tabs.length
            : event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? tabs.length - 1
                : null
      if (next === null) return
      event.preventDefault()
      select(tabs[next])
      tabs[next].focus()
    })
  })
}
function initializeMenu() {
  // A popover of its button: the browser places it and closes it on Esc or a click outside; a chosen item closes it too
  const menu = element('fate-menu')
  menu.addEventListener('toggle', (event) => {
    if ((event as ToggleEvent).newState === 'open') menu.querySelector<HTMLButtonElement>('button')?.focus()
  })
  menu.addEventListener('click', (event) => {
    if ((event.target as Element).closest('[role="menuitem"]')) menu.hidePopover()
  })
}
async function initialize() {
  initializeTabs()
  initializeMenu()
  buildFields()
  const events = element<HTMLSelectElement>('webhook-event')
  for (const [event, label] of webhookEvents) events.add(new Option(label, event))
  bridge = await connectView()
  const catalog = (await command('catalog')) as {
    fates: typeof fates
    templates: typeof templates
    patches: typeof patches
    territories: typeof territories
    universalis?: boolean
    dataError?: string | null
  }
  fates = catalog.fates
  templates = catalog.templates
  patches = catalog.patches
  territories = catalog.territories
  await reload()
  await diagnostics()
  element<HTMLFieldSetElement>('controls').disabled = false
  if (catalog.dataError) show(catalog.dataError, true)
  if (!catalog.universalis) {
    const toggle = element<HTMLInputElement>('field-universalis.enabled')
    toggle.disabled = true
    toggle.removeAttribute('data-path')
    fields.delete('universalis.enabled')
    toggle.checked = false
    element('universalis-note').textContent = '此版本未配置 Universalis，无法查询和上传物价。'
  }

  element('fate-search').addEventListener('input', renderFateList)
  element('fate-template').addEventListener('change', () => {
    const select = element<HTMLSelectElement>('fate-template')
    const template = select.value === '' ? undefined : templates[Number(select.value)]
    select.value = ''
    if (!template) return
    const next = structuredClone(settings)
    next.watch.fates = [...new Set([...next.watch.fates, ...template.fate])]
    void save(next).then(() => show(`已从预设“${name(template.name)}”加入关注`))
  })
  click('fate-select-all', () => updateWatch(listedFates().ids, true))
  click('fate-clear-all', () => updateWatch(listedFates().ids, false))
  click('watch-clear', () => {
    const next = structuredClone(settings)
    next.watch.fates = []
    void save(next)
  })
  click('watch-import', async () => {
    const bytes = await pickFile()
    if (bytes === null) return
    const result = await command('watch.import', { bytes })
    const next = structuredClone(settings)
    next.watch.fates = settingsFrom({ watch: { fates: result } }).watch.fates
    await save(next)
    show('关注列表已导入')
  })
  click('watch-export', async () => {
    download('matcha-watch.json', await command('watch.export', { fates: settings.watch.fates }))
  })
  click('test-notification', async () => {
    await command('test.notification')
    show('已发送测试通知')
    await diagnostics()
  })
  click('diagnostics-refresh', diagnostics)
  click('webhook-add', () => openWebhook(null))
  click('webhook-cancel', () => element<HTMLDialogElement>('webhook-dialog').close())
  element('webhook-type').addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('button')
    if (button?.dataset.value) webhookType(button.dataset.value as Webhook['type'])
  })
  element('webhook-form').addEventListener('submit', (event) => {
    event.preventDefault()
    void submitWebhook()
  })
  click('settings-import', async () => {
    const bytes = await pickFile()
    if (bytes === null) return
    const imported = settingsFrom(JSON.parse(new TextDecoder().decode(bytes)))
    const previous = structuredClone(settings)
    await save(imported)
    beforeImport = previous
    element('settings-undo').hidden = false
    element('import-note').textContent = '已导入。离开此页前可以撤销。'
  })
  click('settings-undo', async () => {
    if (!beforeImport) return
    await save(beforeImport)
    beforeImport = null
    element('settings-undo').hidden = true
    element('import-note').textContent = '替换当前的全部设置。'
    show('已撤销导入')
  })
  click('settings-export', () => {
    download('matcha-settings.json', new TextEncoder().encode(JSON.stringify(settings, null, 2)))
  })
  click('notebook-export', async () => {
    download('matcha-notebook.json', await command('notebook.export'))
  })
}
void initialize().catch((error: unknown) => {
  show(`无法连接 Matcha：${error instanceof Error ? error.message : String(error)}`, true)
})
