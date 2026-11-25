import catalog from 'deep-dungeon:catalog'
import type { Subscription, Value } from '@ffcafe/mojito-plugin-sdk'
import { connectView } from '@ffcafe/mojito-plugin-sdk/view'
import { type Dungeon, dungeons, floorNote } from './data.js'
import { detail, element } from './detail.js'
import { type Display, defaults, type Target } from './state.js'
import './style.css'

async function main() {
  const root = document.querySelector<HTMLElement>('#app')!
  const page = document.body.dataset.page
  const view = await connectView()
  let display: Display = { settings: defaults, language: 'en' }
  const subscriptions: Subscription[] = []
  let stopped = false
  async function subscribe(channel: string, receive: (value: Value) => void) {
    const sub = view.subscribe(channel, ({ items }) => {
      for (const value of items) receive(value)
    })
    subscriptions.push(sub)
    await sub.ready
  }
  let render = () => {}
  let refreshNames = () => {}
  if (page === 'overlay') {
    let current: Target | null = null
    root.className = 'target'
    root.hidden = true
    render = () => {
      root.hidden = current === null
      if (current) detail(root, current.monster, current.name, current.nameId, display.language, current.hp)
      else root.replaceChildren()
    }
    await subscribe('target', (value) => {
      current = value as Target | null
      render()
    })
  } else if (page === 'settings') {
    const form = element('form')
    form.className = 'mojito-panel'
    const field = element('div', undefined, 'mojito-field')
    const label = element('label', '攻略语言')
    label.htmlFor = 'language'
    const select = element('select')
    select.id = 'language'
    for (const [value, text] of [
      ['auto', '跟随界面'],
      ['zhCN', '简体中文'],
      ['en', 'English'],
    ])
      select.add(new Option(text, value))
    field.append(label, select)
    form.append(field)
    const error = element('p')
    error.setAttribute('role', 'alert')
    error.hidden = true
    root.append(form, error)
    form.onsubmit = (event) => event.preventDefault()
    select.onchange = async () => {
      select.disabled = true
      error.hidden = true
      try {
        await view.command('display', { language: select.value })
      } catch {
        error.textContent = '保存失败'
        error.hidden = false
        select.value = display.settings.language
      } finally {
        select.disabled = false
      }
    }
    render = () => {
      select.value = display.settings.language
    }
  } else {
    let dungeon: Dungeon = 'PotD',
      selected: number | null = null
    let localNames: Record<string, string> = {}
    let request: object | null = null
    let section: 'monsters' | 'floors' = 'monsters'
    const tabs = element('div', undefined, 'mojito-tabs')
    tabs.setAttribute('role', 'tablist')
    tabs.setAttribute('aria-label', '查阅内容')
    const monstersTab = element('button', '怪物')
    const floorsTab = element('button', '楼层')
    monstersTab.type = floorsTab.type = 'button'
    for (const [button, id] of [
      [monstersTab, 'monsters'],
      [floorsTab, 'floors'],
    ] as const) {
      button.id = `${id}-tab`
      button.setAttribute('role', 'tab')
      button.setAttribute('aria-controls', id)
    }
    tabs.append(monstersTab, floorsTab)
    tabs.onkeydown = (event) => {
      let button: HTMLButtonElement
      if (event.key === 'Home') button = monstersTab
      else if (event.key === 'End') button = floorsTab
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
        button = document.activeElement === monstersTab ? floorsTab : monstersTab
      else return
      event.preventDefault()
      button.focus()
    }
    const toolbar = element('div', undefined, 'toolbar')
    const dungeonSelect = element('select')
    dungeonSelect.setAttribute('aria-label', '迷宫')
    const dungeonNames = { PotD: '死者宫殿', HoH: '天之御柱', EO: '正统优雷卡', PT: 'PT' }
    for (const key of dungeons) dungeonSelect.add(new Option(key === 'PT' ? key : `${dungeonNames[key]} · ${key}`, key))
    const search = element('input')
    search.type = 'search'
    search.placeholder = '名称或 ID'
    search.setAttribute('aria-label', '搜索怪物')
    toolbar.append(dungeonSelect, search)
    const layout = element('div', undefined, 'reference-layout')
    layout.id = 'monsters'
    layout.setAttribute('role', 'tabpanel')
    layout.setAttribute('aria-labelledby', monstersTab.id)
    const list = element('nav', undefined, 'monster-list')
    list.setAttribute('aria-label', '怪物列表')
    const content = element('article', undefined, 'monster-detail')
    content.id = 'monster-detail'
    layout.append(list, content)
    const floors = element('section', undefined, 'floors')
    floors.id = 'floors'
    floors.setAttribute('role', 'tabpanel')
    floors.setAttribute('aria-labelledby', floorsTab.id)
    const floorSelect = element('select')
    floorSelect.setAttribute('aria-label', '楼层提示组')
    const floorTitle = element('h3')
    const floorText = element('p', undefined, 'notes')
    floors.append(floorSelect, floorTitle, floorText)
    root.append(tabs, toolbar, layout, floors)
    function showSection() {
      layout.hidden = section !== 'monsters'
      search.hidden = section !== 'monsters'
      floors.hidden = section !== 'floors'
      monstersTab.setAttribute('aria-selected', String(section === 'monsters'))
      floorsTab.setAttribute('aria-selected', String(section === 'floors'))
      monstersTab.tabIndex = section === 'monsters' ? 0 : -1
      floorsTab.tabIndex = section === 'floors' ? 0 : -1
    }
    monstersTab.onclick = () => {
      section = 'monsters'
      showSection()
    }
    floorsTab.onclick = () => {
      section = 'floors'
      showSection()
    }
    showSection()
    function drawFloor() {
      const floor = catalog.floors.find((item) => item.dungeon === dungeon && item.key === floorSelect.value)
      floorTitle.textContent = floor ? `${dungeonNames[dungeon]} · ${floor.key}` : '暂无楼层资料'
      const text = floor ? floorNote(catalog, floor, display.language) : null
      floorText.textContent = text ?? ''
      floorText.hidden = text === null
    }
    function drawDetail() {
      const monster = catalog.monsters.find((item) => item.nameId === selected && item.dungeons.includes(dungeon))
      if (monster)
        detail(content, monster, localNames[monster.nameId] ?? monster.upstreamName, monster.nameId, display.language)
      else content.replaceChildren(element('p', '没有匹配的怪物', 'empty'))
      for (const button of list.querySelectorAll('button'))
        button.setAttribute('aria-current', String(Number(button.dataset.id) === selected))
    }
    render = () => {
      const query = search.value.trim().toLocaleLowerCase()
      const items = catalog.monsters.filter(
        (item) =>
          item.dungeons.includes(dungeon) &&
          [item.upstreamName, localNames[item.nameId] ?? '', String(item.nameId)].some((text) =>
            text.toLocaleLowerCase().includes(query),
          ),
      )
      if (!items.some((item) => item.nameId === selected)) selected = items[0]?.nameId ?? null
      list.replaceChildren()
      for (const item of items) {
        const button = element('button')
        button.type = 'button'
        button.dataset.id = String(item.nameId)
        button.setAttribute('aria-controls', content.id)
        button.append(
          element('span', localNames[item.nameId] ?? item.upstreamName),
          element('small', `#${item.nameId}`),
        )
        button.onclick = () => {
          selected = item.nameId
          drawDetail()
        }
        list.append(button)
      }
      drawDetail()
      drawFloor()
    }
    async function loadNames() {
      const current = {}
      request = current
      localNames = {}
      render()
      try {
        const result = (await view.command('reference', {
          ids: catalog.monsters.filter((item) => item.dungeons.includes(dungeon)).map((item) => item.nameId),
        })) as { language: string | null; names: Record<string, string> }
        if (!stopped && request === current) {
          localNames = result.names
          render()
        }
      } catch {
        /* Source names remain usable while client data is unavailable. */
      }
    }
    function changeDungeon() {
      dungeon = dungeonSelect.value as Dungeon
      selected = null
      floorSelect.replaceChildren()
      for (const floor of catalog.floors.filter((item) => item.dungeon === dungeon && !item.redirect))
        floorSelect.add(new Option(floor.key, floor.key))
      floorSelect.hidden = floorSelect.options.length === 0
      void loadNames()
    }
    dungeonSelect.onchange = changeDungeon
    search.oninput = () => render()
    floorSelect.onchange = drawFloor
    refreshNames = () => void loadNames()
    changeDungeon()
  }
  await subscribe('display', (value) => {
    const previous = display.language
    display = value as Display
    render()
    if (display.language !== previous) refreshNames()
  })
  window.addEventListener(
    'pagehide',
    () => {
      stopped = true
      for (const sub of subscriptions) sub.dispose()
    },
    { once: true },
  )
}
void main().catch((error) => console.error('Deep dungeon view failed', error))
