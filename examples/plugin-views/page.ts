import { connectView } from '@ffcafe/mojito-plugin-sdk/view'

const output = document.querySelector('output')!
const button = document.querySelector('button')!
try {
  const view = await connectView()
  const subscription = view.subscribe('counter', (batch) => {
    for (const item of batch.items) {
      if (item && typeof item === 'object' && 'count' in item) output.value = String(item.count)
    }
  })
  await subscription.ready
  button.addEventListener('click', () => {
    void view.command('increment', null)
  })
  button.disabled = false
  document.body.dataset.ready = 'true'
  window.addEventListener('pagehide', () => subscription.dispose(), { once: true })
} catch (error) {
  output.value = error instanceof Error ? error.message : String(error)
}
