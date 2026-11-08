import type { ClockState, GameIcon } from '@ffcafe/mojito-plugin-sdk'
import { connectView } from '@ffcafe/mojito-plugin-sdk/view'
import type { Action, DisplayState, Settings } from './state.js'
import './style.css'

type Anchor = { clock: ClockState; received: number; rate: number }
export function anchor(previous: Anchor | null, clock: ClockState, received: number): Anchor {
  const same =
    previous &&
    previous.clock.source === clock.source &&
    previous.clock.base === clock.base &&
    previous.clock.generation === clock.generation &&
    previous.clock.now !== null &&
    clock.now !== null
  let rate = same ? previous.rate : 0
  if (clock.now === null || !clock.source) rate = 0
  else if (clock.source === 'live') rate = 1
  else if (same && !previous.clock.paused && !clock.paused && received > previous.received) {
    const delta = clock.now - previous.clock.now!
    if (delta >= 0) rate = delta / (received - previous.received)
  }
  if (same && clock.source === 'live' && !clock.paused && !previous.clock.paused) {
    clock = { ...clock, now: Math.max(clock.now!, previous.clock.now! + Math.max(0, received - previous.received)) }
  }
  return { clock, received, rate }
}

export function strip(root: HTMLElement, icon: (id: number) => Promise<string | null>) {
  root.classList.add('strip')
  const ruler = document.createElement('div')
  ruler.className = 'ruler'
  const ticks = [0, 1, 2].map(() => {
    const tick = document.createElement('span')
    ruler.append(tick)
    return tick
  })
  root.append(ruler)
  const nodes = new Map<string, { element: HTMLSpanElement; action: Action }>()
  let config: Settings = { seconds: 10, scale: 100, newest: 'right' }
  let resource = '',
    generation = 0
  return {
    update(actions: Action[], settings: Settings, resources: string) {
      config = settings
      if (resource !== resources) {
        resource = resources
        ++generation
        for (const { element } of nodes.values()) element.remove()
        nodes.clear()
      }
      const keys = new Set(actions.map((action) => action.key))
      for (const [key, { element }] of nodes)
        if (!keys.has(key)) {
          element.remove()
          nodes.delete(key)
        }
      for (const action of actions) {
        let item = nodes.get(action.key)
        if (!item) {
          const element = document.createElement('span')
          element.className = 'action'
          element.hidden = true
          element.dataset.key = action.key
          element.dataset.id = String(action.id)
          element.textContent = String(action.id)
          root.append(element)
          item = { element, action }
          nodes.set(action.key, item)
        }
        item.action = action
        const { element } = item
        element.dataset.row = action.gcd ? 'gcd' : 'ability'
        element.title = action.name
        element.setAttribute('aria-label', action.name)
        if (action.icon && !element.dataset.requested) {
          element.dataset.requested = 'true'
          const current = generation
          void icon(action.id).then((url) => {
            if (!url || current !== generation || !element.isConnected) return
            const image = document.createElement('img')
            image.src = url
            image.alt = action.name
            element.replaceChildren(image)
          })
        }
      }
    },
    draw(now: number | null) {
      const scale = config.scale / 100,
        margin = 20 * scale
      const width = Math.max(0, root.clientWidth - margin * 2)
      let visible = false
      for (const { element, action } of nodes.values()) {
        const age = now === null ? -1 : now - action.at
        const show = age >= 0 && age < config.seconds * 1000
        element.hidden = !show
        if (!show) continue
        visible = true
        const fraction = age / (config.seconds * 1000)
        const size = (action.gcd ? 40 : 28) * scale
        const x = margin + width * (config.newest === 'right' ? 1 - fraction : fraction)
        element.style.fontSize = `${Math.min(11, size / (String(action.id).length * 0.65))}px`
        element.style.width = `${size}px`
        element.style.height = `${size}px`
        element.style.left = `${x}px`
        element.style.top = `${(action.gcd ? 64 : 26) * scale}px`
      }
      ruler.hidden = !visible
      ruler.style.top = `${Math.min(92 * scale, root.clientHeight - 14)}px`
      ticks.forEach((tick, index) => {
        const fraction = index / 2
        tick.textContent = `${fraction === 0 ? '' : '−'}${config.seconds * fraction}s`
        tick.style.left = `${margin + width * (config.newest === 'right' ? 1 - fraction : fraction)}px`
      })
    },
    dispose() {
      ++generation
      root.replaceChildren()
      nodes.clear()
    },
  }
}

async function main() {
  const app = document.querySelector<HTMLElement>('#app')!
  const settingsPage = document.body.dataset.page === 'settings'
  let reason: HTMLElement | null = null,
    error: HTMLElement | null = null
  const selects: HTMLSelectElement[] = []
  if (settingsPage) {
    app.innerHTML = `<h1>SkillDisplay</h1><form>
      <label>显示时长<select name="seconds"><option value="5">5 秒</option><option value="10">10 秒</option><option value="20">20 秒</option></select></label>
      <label>图标大小<select name="scale"><option value="75">75%</option><option value="100">100%</option><option value="125">125%</option><option value="150">150%</option></select></label>
      <label>最新位置<select name="newest"><option value="right">右侧</option><option value="left">左侧</option></select></label>
      </form><p class="error" role="alert" hidden></p><p class="reason" role="status" hidden></p><h2>预览</h2>`
    reason = app.querySelector('.reason')
    error = app.querySelector('.error')
    selects.push(...app.querySelectorAll('select'))
    for (const select of selects) select.disabled = true
  }
  const surface = document.createElement('div')
  app.append(surface)
  let stopped = false,
    frame = 0,
    resource = '',
    imageGeneration = 0
  const urls = new Map<number, Promise<string | null>>()
  const allocated = new Set<string>()
  const clearImages = () => {
    ++imageGeneration
    for (const url of allocated) URL.revokeObjectURL(url)
    allocated.clear()
    urls.clear()
  }
  const bridge = await connectView()
  const display = strip(surface, (id) => {
    let request = urls.get(id)
    if (!request) {
      const generation = imageGeneration
      request = bridge
        .command('display', { type: 'icon', id })
        .then((result) => {
          const icon = result as unknown as GameIcon | null
          if (!icon || stopped || generation !== imageGeneration) return null
          const url = URL.createObjectURL(new Blob([new Uint8Array(icon.data)], { type: icon.mime }))
          allocated.add(url)
          return url
        })
        .catch(() => null)
      urls.set(id, request)
    }
    return request
  })
  let state: DisplayState | null = null,
    current: Anchor | null = null,
    busy = false
  const updateControls = () => {
    if (!state) return
    for (const select of selects) {
      select.value = String(state.settings[select.name as keyof Settings])
      select.disabled = busy
    }
  }
  for (const select of selects)
    select.addEventListener('change', () => {
      if (!state) return
      const value = { ...state.settings, [select.name]: select.name === 'newest' ? select.value : Number(select.value) }
      busy = true
      updateControls()
      void bridge
        .command('display', { type: 'settings', value })
        .then((saved) => {
          if (state) state = { ...state, settings: saved as Settings }
          if (error) error.hidden = true
        })
        .catch(() => {
          if (error) {
            error.textContent = '保存失败，请重试'
            error.hidden = false
          }
        })
        .finally(() => {
          busy = false
          updateControls()
          render()
        })
    })
  const previewStart = performance.now()
  let previewCycle = -1
  const preview = (cycle: number): Action[] =>
    [
      { id: 9, gcd: true, at: 0 },
      { id: 31, gcd: false, at: 800 },
      { id: 9, gcd: true, at: 2500 },
      { id: 42, gcd: false, at: 3400 },
      { id: 999999, gcd: false, at: 4300 },
      { id: 9, gcd: true, at: 5000 },
    ].map((action, index) => ({
      ...action,
      at: action.at + cycle * 12000,
      key: String(index),
      name: String(action.id),
      icon: action.id === 999999 ? null : 1,
    }))
  function render() {
    if (!state) return
    if (settingsPage) display.update(preview(Math.max(0, previewCycle)), state.settings, resource)
    else display.update(state.actions, state.settings, resource)
  }
  function receive(value: DisplayState) {
    if (stopped) return
    if (resource !== value.resources) {
      resource = value.resources
      current = null
      clearImages()
    }
    state = value
    current = anchor(current, value.clock, performance.now())
    if (reason) {
      reason.textContent = value.reason
      reason.hidden = !value.reason
    }
    updateControls()
    render()
  }
  const subscription = bridge.subscribe('display', (batch) => {
    for (const value of batch.items) receive(value as DisplayState)
  })
  await subscription.ready
  // The subscription's initial value wins over a slower explicit snapshot.
  if (!state) {
    const value = await bridge.snapshot('display')
    if (!state && value) receive(value as DisplayState)
  }
  function draw(local: number) {
    if (stopped) return
    if (settingsPage) {
      const now = local - previewStart,
        cycle = Math.floor(now / 12000)
      if (cycle !== previewCycle) {
        previewCycle = cycle
        render()
      }
      display.draw(now)
    } else
      display.draw(
        current?.clock.now === null || !current
          ? null
          : current.clock.now + (current.clock.paused ? 0 : Math.max(0, local - current.received) * current.rate),
      )
    frame = requestAnimationFrame(draw)
  }
  frame = requestAnimationFrame(draw)
  window.addEventListener(
    'pagehide',
    () => {
      stopped = true
      cancelAnimationFrame(frame)
      subscription.dispose()
      display.dispose()
      clearImages()
    },
    { once: true },
  )
}
if (typeof document !== 'undefined' && document.querySelector('#app'))
  void main().catch((error) => {
    if (document.body.dataset.page === 'settings')
      document.querySelector('#app')!.textContent = `SkillDisplay 暂不可用：${String(error)}`
  })
