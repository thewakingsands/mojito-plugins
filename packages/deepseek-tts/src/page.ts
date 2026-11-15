import type { Value } from '@ffcafe/mojito-plugin-sdk'
import { connectView } from '@ffcafe/mojito-plugin-sdk/view'
import { estimateYuan, PRICE_PER_10K_CHARS } from './billing.js'
import type { Usage } from './entry.js'
import './style.css'

const number = new Intl.NumberFormat('zh-CN')
// 已保存 Key 时输入框里显示的占位内容；页面拿不到真实的 Key。
export const MASK = '●'.repeat(16)

export function formatUsage(usage: Usage | null): string {
  if (!usage) return '还没有产生费用'
  return `自 ${usage.since} 起：${number.format(usage.chars)} 个计费字符，约 ¥${estimateYuan(usage.chars)}`
}

/**
 * 已保存 Key 时输入框显示一串实心圆；获得焦点时清空以便输入，失去焦点时如果没有输入内容就恢复实心圆。
 * `value()` 返回用户输入的新 Key，没有输入时为空字符串。
 */
export function keyInput(input: HTMLInputElement) {
  let saved = false,
    masked = false
  const mask = () => {
    masked = saved && !input.value && input.ownerDocument.activeElement !== input
    if (masked) input.value = MASK
  }
  input.addEventListener('focus', () => {
    if (masked) input.value = ''
    masked = false
  })
  input.addEventListener('blur', mask)
  return {
    set(hasKey: boolean) {
      saved = hasKey
      input.value = ''
      mask()
    },
    value: () => (masked ? '' : input.value.trim()),
  }
}

/** `interestfor` 只对按钮和链接生效；问号只是图标，悬停或键盘聚焦时由脚本打开提示 */
export function hint(anchor: HTMLElement, tip: HTMLElement) {
  const show = () => {
    if (!tip.matches(':popover-open')) tip.showPopover({ source: anchor })
  }
  const hide = () => {
    if (tip.matches(':popover-open')) tip.hidePopover()
  }
  anchor.addEventListener('pointerenter', show)
  anchor.addEventListener('pointerleave', hide)
  anchor.addEventListener('focus', show)
  anchor.addEventListener('blur', hide)
}

const icon = (paths: string) =>
  `<svg class="lucide" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
const triangleAlert = icon(
  '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
)
const circleHelp = icon(
  '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
)

const template = `
<p id="no-key" class="mojito-callout" data-tone="warn" role="status" hidden>${triangleAlert}<span>未填写 DeepSeek API Key，海星、暗潮两个音色不会出现在 TTS 设置中。</span></p>
<section class="mojito-panel" data-preference="api-key">
  <div class="mojito-field">
    <label for="key">API Key</label>
    <div class="row">
      <input id="key" type="password" autocomplete="off" spellcheck="false">
      <button id="clear-key" type="button">清除</button>
      <button id="save-key" type="button" data-variant="primary">保存</button>
    </div>
  </div>
  <p class="error" role="alert" hidden></p>
</section>
<section class="mojito-panel" data-preference="usage">
  <div class="mojito-field">
    <div class="title">
      <span>累计费用</span>
      <span class="help" tabindex="0" aria-label="说明" aria-describedby="usage-tip">${circleHelp}</span>
      <span id="usage-tip" popover="hint">按刊例价 ${PRICE_PER_10K_CHARS} 元/万字符估算，未计折扣，实际以 DeepSeek 账单为准</span>
    </div>
    <output id="usage"></output>
  </div>
  <p class="error" role="alert" hidden></p>
</section>`

async function main() {
  const app = document.querySelector<HTMLElement>('#app')!
  app.innerHTML = template
  const $ = <T extends HTMLElement>(selector: string) => app.querySelector<T>(selector)!
  const input = $<HTMLInputElement>('#key')
  const key = keyInput(input)
  const save = $<HTMLButtonElement>('#save-key')
  const clear = $<HTMLButtonElement>('#clear-key')
  const showError = (id: string, error: unknown) => {
    const element = $(`[data-preference="${id}"] .error`)
    element.textContent = error ? `操作失败：${error instanceof Error ? error.message : String(error)}` : ''
    element.hidden = !error
  }
  const bridge = await connectView()
  const command = (value: Value) => bridge.command('settings', value)

  async function refresh() {
    const { hasKey, usage } = (await command({ type: 'getSettings' })) as unknown as {
      hasKey: boolean
      usage: Usage | null
    }
    key.set(hasKey)
    $('#no-key').hidden = hasKey
    clear.disabled = !hasKey
    $('#usage').textContent = formatUsage(usage)
  }
  async function setKey(button: HTMLButtonElement, value: string) {
    button.disabled = true
    button.setAttribute('aria-busy', 'true')
    try {
      await command({ type: 'setApiKey', value })
      showError('api-key', null)
    } catch (error) {
      showError('api-key', error)
    } finally {
      button.disabled = false
      button.removeAttribute('aria-busy')
      await refresh().catch((error) => showError('api-key', error))
    }
  }
  save.addEventListener('click', () => {
    const value = key.value()
    if (value) void setKey(save, value)
  })
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') save.click()
  })
  clear.addEventListener('click', () => void setKey(clear, ''))
  hint($('.help'), $('#usage-tip'))

  bridge.on('navigate-to-preference-item', ({ id }) => {
    const target = app.querySelector<HTMLElement>(`[data-preference="${CSS.escape(id)}"]`)
    if (!target) return
    target.scrollIntoView({ block: 'center' })
    target.classList.remove('highlight')
    void target.offsetWidth
    target.classList.add('highlight')
  })

  await refresh().catch((error) => showError('api-key', error))
}
if (typeof document !== 'undefined' && document.querySelector('#app'))
  void main().catch((error) => {
    document.querySelector('#app')!.textContent = `DeepSeek 语音暂不可用：${String(error)}`
  })
