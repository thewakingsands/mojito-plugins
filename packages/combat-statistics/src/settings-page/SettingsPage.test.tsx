// @vitest-environment jsdom

import type { ViewBridge } from '@ffcafe/mojito-plugin-sdk/view'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { defaults } from '../model.js'
import { Bridge } from '../page/bridge.js'
import { SettingsPage } from './SettingsPage.js'

afterEach(cleanup)
function setup(available: boolean) {
  const command = vi.fn(async () => null)
  const view = {
    subscribe: (_channel: string, listener: (batch: unknown) => void) => {
      listener({ items: [{ settings: defaults, telemetryAvailable: available }] })
      return { dispose() {} }
    },
  } as unknown as ViewBridge
  render(
    <Bridge.Provider value={{ view, command }}>
      <SettingsPage />
    </Bridge.Provider>,
  )
  return command
}
it('keeps the opt-in disabled without network permission', () => {
  setup(false)
  const checkbox = screen.getByLabelText('共享匿名状态样本') as HTMLInputElement
  expect(checkbox.checked).toBe(false)
  expect(checkbox.disabled).toBe(true)
  expect(screen.getByText('请先在宿主的插件权限中允许网络请求。')).toBeTruthy()
})
it('saves consent using the existing settings command and shows failures', async () => {
  const command = setup(true)
  fireEvent.click(screen.getByLabelText('共享匿名状态样本'))
  fireEvent.click(screen.getByText('保存设置'))
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith({ kind: 'settings', value: { ...defaults, telemetryEnabled: true } }),
  )
  await screen.findByText('已保存')
  command.mockRejectedValueOnce(new Error('保存失败') as never)
  fireEvent.click(screen.getByText('保存设置'))
  await screen.findByText('保存失败')
})
