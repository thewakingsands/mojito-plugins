import { connectView } from '@ffcafe/mojito-plugin-sdk/view'

const output = document.querySelector('output')!
const buttons = [...document.querySelectorAll('button')]
try {
  const view = await connectView()
  for (const button of buttons) {
    button.addEventListener('click', () => {
      output.value = ''
      view.command('say', button.value).catch((error) => {
        output.value = error instanceof Error ? error.message : String(error)
      })
    })
    button.disabled = false
  }
} catch (error) {
  output.value = error instanceof Error ? error.message : String(error)
}
