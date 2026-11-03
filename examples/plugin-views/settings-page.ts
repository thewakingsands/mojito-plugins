import { connectView } from '@ffcafe/mojito-plugin-sdk/view'

// The host opens this page again for every jump from its settings search or Ctrl K and then sends the event once
const view = await connectView()
const note = document.createElement('p')
note.className = 'mojito-secondary'
let jumps = 0
view.on('navigate-to-preference-item', ({ id, keyword }) => {
  const field = document.querySelector<HTMLElement>(`[data-preference="${CSS.escape(id)}"]`)
  // An ID this page does not know, e.g. from items replaced a moment ago, is ignored
  if (!field) return
  for (const other of document.querySelectorAll<HTMLElement>('[data-highlighted]')) delete other.dataset.highlighted
  field.dataset.highlighted = ''
  field.scrollIntoView({ block: 'center' })
  field.querySelector<HTMLElement>('input, select')?.focus()
  note.textContent = keyword ? `从宿主搜索“${keyword}”跳转到这里` : '从宿主搜索跳转到这里'
  document.querySelector('h1')!.after(note)
  document.body.dataset.preferenceJumps = String(++jumps)
})
