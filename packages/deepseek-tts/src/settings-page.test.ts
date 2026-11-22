// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'

const command = vi.fn()
vi.mock('@ffcafe/mojito-plugin-sdk/view', () => ({
  connectView: async () => ({ command, on: () => {} }),
}))

it('keeps the key the user typed when saving it fails', async () => {
  command.mockImplementation(async (_channel: string, value: { type: string }) => {
    if (value.type === 'setApiKey') throw new Error('disk full')
    return { hasKey: false, usage: null }
  })
  document.body.innerHTML = '<div id="app"></div>'
  await import('./page.js')
  await vi.waitFor(() => expect(command).toHaveBeenCalledWith('settings', { type: 'getSettings' }))
  const input = document.querySelector<HTMLInputElement>('#key')!
  input.dispatchEvent(new Event('focus'))
  input.value = 'sk-typed'
  document.querySelector<HTMLButtonElement>('#save-key')!.click()
  await vi.waitFor(() =>
    expect(document.querySelector('[data-preference="api-key"] .error')?.textContent).toContain('disk full'),
  )
  await vi.waitFor(() => expect(command).toHaveBeenCalledTimes(3))
  expect(input.value).toBe('sk-typed')
})
