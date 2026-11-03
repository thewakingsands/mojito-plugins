import { connectView } from '@ffcafe/mojito-plugin-sdk/view'
import { element, type State } from './state'
import './style.css'

document.body.classList.add('overlay')
const app = document.querySelector('#app')!
let latest: State | undefined
const bridge = await connectView()
const receive = (state: State) => {
  if (
    latest &&
    (state.generation < latest.generation ||
      (state.generation === latest.generation && state.revision < latest.revision))
  )
    return
  latest = state
  app.replaceChildren()
  if (state.moduleFault || state.sourceError) {
    const status = element('p', state.moduleFault ?? state.sourceError ?? '')
    status.className = 'overlay-status'
    app.append(status)
  }
  for (const alert of state.alerts) {
    const text = element('p', alert.text)
    text.className = alert.level
    text.setAttribute('role', 'status')
    app.append(text)
  }
  for (const bar of state.bars) {
    const remaining = state.clock.now === null ? '—' : Math.max(0, (bar.endsAt - state.clock.now) / 1000).toFixed(1)
    const row = element('div')
    row.className = 'timeline-bar'
    row.append(element('span', bar.text), element('span', `${remaining}s${state.clock.paused ? ' · 暂停' : ''}`))
    app.append(row)
  }
}
const sub = bridge.subscribe('raidboss', (batch) => {
  for (const value of batch.items) receive(value as unknown as State)
})
await sub.ready
receive((await bridge.snapshot('raidboss')) as unknown as State)
