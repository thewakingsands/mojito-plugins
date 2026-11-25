import type { Value } from '@ffcafe/mojito-plugin-sdk'
import { connectView } from '@ffcafe/mojito-plugin-sdk/view'
import { element, type State } from './state'
import './style.css'

document.body.classList.add('overlay')
const app = document.querySelector('#app')!
let latest: State | undefined
let remainingLabels: HTMLSpanElement[] = []
const bridge = await connectView()
const statusText = (state: State) => state.moduleFault ?? state.sourceError
const sameContent = (previous: State, next: State) =>
  statusText(previous) === statusText(next) &&
  previous.alerts.length === next.alerts.length &&
  previous.alerts.every((alert, index) => {
    const other = next.alerts[index]!
    return (
      alert.id === other.id && alert.setId === other.setId && alert.level === other.level && alert.text === other.text
    )
  }) &&
  previous.bars.length === next.bars.length &&
  previous.bars.every((bar, index) => {
    const other = next.bars[index]!
    return bar.setId === other.setId && bar.id === other.id && bar.text === other.text && bar.endsAt === other.endsAt
  })

const receive = (value: Value) => {
  if (value === null) return
  const state = value as unknown as State
  if (
    latest &&
    (state.generation < latest.generation ||
      (state.generation === latest.generation && state.revision < latest.revision))
  )
    return
  if (!latest || !sameContent(latest, state)) {
    app.replaceChildren()
    const message = statusText(state)
    if (message) {
      const status = element('p', message)
      status.className = 'overlay-status'
      app.append(status)
    }
    for (const alert of state.alerts) {
      const text = element('p', alert.text)
      text.className = alert.level
      text.setAttribute('role', 'status')
      app.append(text)
    }
    remainingLabels = state.bars.map((bar) => {
      const row = element('div')
      row.className = 'timeline-bar'
      const label = element('span')
      row.append(element('span', bar.text), label)
      app.append(row)
      return label
    })
  }
  latest = state
  for (const [index, bar] of state.bars.entries()) {
    const remaining = state.clock.now === null ? '—' : Math.max(0, (bar.endsAt - state.clock.now) / 1000).toFixed(1)
    const label = remainingLabels[index]!
    const text = `${remaining}s${state.clock.paused ? ' · 暂停' : ''}`
    if (label.textContent !== text) label.textContent = text
  }
}
const sub = bridge.subscribe('raidboss', (batch) => {
  for (const value of batch.items) receive(value)
})
await sub.ready
receive(await bridge.snapshot('raidboss'))
