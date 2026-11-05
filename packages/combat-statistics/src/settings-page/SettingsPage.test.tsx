// @vitest-environment jsdom
import type { Value } from '@ffcafe/mojito-plugin-sdk'
import type { ViewBridge } from '@ffcafe/mojito-plugin-sdk/view'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { defaults } from '../model.js'
import { Bridge } from '../page/bridge.js'
import type { Command, StatisticsState } from '../view-model.js'
import { SettingsPage } from './SettingsPage.js'

// jsdom has no showModal or close.
const { showModal, close } = HTMLDialogElement.prototype
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
afterEach(() => {
  cleanup()
  HTMLDialogElement.prototype.showModal = showModal
  HTMLDialogElement.prototype.close = close
})

function show(available = true) {
  const sent: Command[] = []
  const failures: string[] = []
  const view = {
    subscribe: (_: string, listener: (batch: { items: Value[] }) => void) => {
      listener({ items: [{ settings: defaults, telemetryAvailable: available } as unknown as StatisticsState as unknown as Value] })
      return { dispose() {} }
    },
  } as unknown as ViewBridge
  const command = async (input: Command) => {
    sent.push(input)
    const failure = failures.shift()
    if (failure) throw new Error(failure)
    return null
  }
  render(
    <Bridge.Provider value={{ view, command }}>
      <SettingsPage />
    </Bridge.Provider>,
  )
  return { sent, failures }
}
const quiet = () => screen.getByLabelText('脱战判定时间') as HTMLInputElement
const scope = () => screen.getByLabelText('解析范围') as HTMLSelectElement
const settle = () => act(async () => {})

it('saves a changed scope or pet setting right away and has no save button', async () => {
  const { sent } = show()
  fireEvent.change(scope(), { target: { value: 'all' } })
  await settle()
  fireEvent.click(screen.getByLabelText('合并宠物'))
  await settle()
  expect(sent).toEqual([
    { kind: 'settings', value: { ...defaults, scope: 'all' } },
    { kind: 'settings', value: { ...defaults, scope: 'all', mergePets: false } },
  ])
  expect(screen.queryByText('保存设置')).toBeNull()
})
it('saves the quiet time when the input loses focus or on Enter, not while it is typed', async () => {
  const { sent } = show()
  fireEvent.change(quiet(), { target: { value: '30' } })
  expect(sent).toEqual([])
  fireEvent.blur(quiet())
  await settle()
  fireEvent.change(quiet(), { target: { value: '40' } })
  fireEvent.keyDown(quiet(), { key: 'Enter' })
  await settle()
  expect(sent).toEqual([
    { kind: 'settings', value: { ...defaults, quietSeconds: 30 } },
    { kind: 'settings', value: { ...defaults, quietSeconds: 40 } },
  ])
  expect(quiet().value).toBe('40')
})
it('keeps an out-of-range quiet time in the input with its error and sends nothing', () => {
  const { sent } = show()
  fireEvent.change(quiet(), { target: { value: '200' } })
  fireEvent.blur(quiet())
  expect(sent).toEqual([])
  expect(screen.getByText('脱战判定时间必须为 3～120 秒的整数')).not.toBeNull()
  expect(quiet().getAttribute('aria-invalid')).toBe('true')
  expect(quiet().getAttribute('aria-describedby')).toBe('quiet-error')
  expect(quiet().value).toBe('200')
})
it('shows why a save failed, restores the saved value and drops the message after the next save', async () => {
  const { failures } = show()
  failures.push('磁盘已满')
  fireEvent.change(scope(), { target: { value: 'all' } })
  await settle()
  expect(screen.getByText('保存失败：磁盘已满')).not.toBeNull()
  expect(scope().value).toBe('party')
  fireEvent.change(scope(), { target: { value: 'alliance' } })
  await settle()
  expect(screen.queryByText(/保存失败/)).toBeNull()
  expect(scope().value).toBe('alliance')
})
it('opens the clear dialog with the focus on 取消, and 取消 closes it without clearing', () => {
  const { sent } = show()
  fireEvent.click(screen.getAllByText('清空')[0])
  const dialog = document.getElementById('clear-dialog')!
  expect(dialog.hasAttribute('open')).toBe(true)
  expect(document.activeElement).toBe(screen.getByText('取消'))
  fireEvent.click(screen.getByText('取消'))
  expect(dialog.hasAttribute('open')).toBe(false)
  expect(sent).toEqual([])
})
it('clears from the dialog, closes it and shows the result', async () => {
  const { sent, failures } = show()
  const dialog = document.getElementById('clear-dialog')!
  const confirm = () => dialog.querySelector<HTMLButtonElement>('button[data-variant="danger"]')!
  fireEvent.click(screen.getAllByText('清空')[0])
  fireEvent.click(confirm())
  expect(dialog.hasAttribute('open')).toBe(false)
  await settle()
  expect(sent).toEqual([{ kind: 'clear' }])
  expect(screen.getByText('已清空')).not.toBeNull()
  failures.push('文件被占用')
  fireEvent.click(screen.getAllByText('清空')[0])
  fireEvent.click(confirm())
  await settle()
  expect(screen.getByText('清空失败：文件被占用')).not.toBeNull()
})

it('keeps anonymous sampling disabled without HTTP permission', () => {
  show(false)
  const checkbox = screen.getByLabelText('共享匿名状态样本') as HTMLInputElement
  expect(checkbox.checked).toBe(false)
  expect(checkbox.disabled).toBe(true)
})
it('saves anonymous sampling consent immediately and restores it if saving fails', async () => {
  const {sent, failures} = show()
  fireEvent.click(screen.getByLabelText('共享匿名状态样本'))
  await settle()
  expect(sent).toEqual([{kind:'settings',value:{...defaults,telemetryEnabled:true}}])
  failures.push('保存失败')
  fireEvent.click(screen.getByLabelText('共享匿名状态样本'))
  await settle()
  expect((screen.getByLabelText('共享匿名状态样本') as HTMLInputElement).checked).toBe(false)
  expect(screen.getByText('保存失败：保存失败')).not.toBeNull()
})
