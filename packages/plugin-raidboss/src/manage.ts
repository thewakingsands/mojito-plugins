import { connectView } from '@ffcafe/mojito-plugin-sdk/view'
import type { Diagnostic, RuleConfig, Settings } from '@ffcafe/mojito-raidboss'
import { type Catalog, element, type State } from './state'
import './style.css'

const app = document.querySelector('#app')!
const note = element('p', '请只启用一个 Raidboss 插件。')
note.className = 'mojito-secondary'
const status = element('p'),
  errors = element('p'),
  form = element('section'),
  list = element('section')
form.className = 'mojito-panel'
errors.setAttribute('role', 'status')
const search = element('input')
search.type = 'search'
search.placeholder = '搜索规则'
search.setAttribute('aria-label', '搜索规则')
const filter = () => {
  for (const row of list.querySelectorAll('details'))
    row.hidden = !row.textContent?.toLowerCase().includes(search.value.toLowerCase())
}
search.oninput = filter
app.append(status, form, errors, search, list, note)
let latest: State | undefined,
  catalog: Catalog | undefined,
  diagnostics = new Map<string, Diagnostic>(),
  draft: Settings | undefined,
  edited = false,
  expectedRevision = 0
let renderKey = ''
const invalid = new Set<HTMLTextAreaElement>()
const diagnosticRows = new Map<string, { status: HTMLElement; detail: HTMLElement }>()
const ruleKey = (setId: string, triggerId: string) => `${setId}\n${triggerId}`
const labels: Record<string, string> = {
  ready: '就绪',
  disabled_by_user: '已停用',
  needs_completion: '待补全',
  unsupported: '不支持',
  missing_data: '缺少数据',
  faulted: '运行出错',
  unverified: '未验证',
}
const bridge = await connectView()
const touch = () => {
  if (!edited) expectedRevision = latest!.configRevision
  edited = true
}
const select = (values: string[], selected: string, change: (value: string) => void) => {
  const el = element('select')
  for (const value of values) {
    const option = element(
      'option',
      (
        {
          cn: '简体中文',
          tc: '繁體中文',
          tts: '语音',
          sound: '音效',
          none: '静音',
          default: '默认',
          info: '信息',
          alert: '注意',
          alarm: '警报',
        } as Record<string, string>
      )[value] ?? value,
    )
    option.value = value
    el.append(option)
  }
  el.value = selected
  el.addEventListener('change', () => {
    touch()
    change(el.value)
  })
  return el
}
const receive = (state: State) => {
  if (
    latest &&
    (state.generation < latest.generation ||
      (state.generation === latest.generation && state.revision < latest.revision))
  )
    return
  latest = state
  diagnostics = new Map(state.diagnostics.map((row) => [ruleKey(row.setId, row.triggerId), row]))
  status.textContent = [
    `区域 ${state.zone ?? '未知'}`,
    state.sourceError,
    state.moduleFault,
    !state.audioGranted && '未授权音频，仅显示文字',
    state.sharedDataWarning && '部分规则出错，共享数据可能不完整',
  ]
    .filter(Boolean)
    .join(' · ')
  for (const [key, row] of diagnosticRows) {
    const diag = diagnostics.get(key)
    row.status.textContent = `${labels[diag?.state ?? 'unverified']} · ${diag?.matches ?? 0} 次`
    row.detail.textContent = diag?.reason ?? '当前区域未运行'
  }
  render()
}
const receiveCatalog = (next: Catalog) => {
  if (!next || (catalog && next.revision < catalog.revision)) return
  catalog = next
  render()
}
const render = () => {
  // The catalog is published separately; wait until it matches the state that refers to it.
  if (!latest || !catalog || catalog.revision !== latest.catalogRevision) return
  const state = latest
  const nextKey = `${catalog.revision}|${state.configRevision}`
  if (edited || nextKey === renderKey) return
  renderKey = nextKey
  invalid.clear()
  diagnosticRows.clear()
  draft = structuredClone(state.settings)
  expectedRevision = state.configRevision
  form.replaceChildren()
  const language = element('label', '输入 / 提示语言 ')
  language.append(
    select(['cn', 'en', 'ja', 'de', 'fr', 'ko', 'tc'], draft.language, (value) => {
      draft!.language = value as Settings['language']
    }),
  )
  const audio = element('label', '音频 ')
  audio.append(
    select(['tts', 'sound', 'none'], draft.audio, (value) => {
      draft!.audio = value as Settings['audio']
    }),
  )
  const save = element('button', '保存设置'),
    reset = element('button', '撤销未保存修改')
  save.dataset.variant = 'primary'
  save.onclick = () => {
    void bridge
      .command('settings', { expectedRevision, settings: draft! } as never)
      .then(async () => {
        edited = false
        receiveCatalog((await bridge.snapshot('raidboss-catalog')) as unknown as Catalog)
        receive((await bridge.snapshot('raidboss')) as unknown as State)
        errors.textContent = ''
      })
      .catch((error) => {
        errors.textContent = String(error)
      })
  }
  reset.onclick = () => {
    edited = false
    renderKey = ''
    render()
    errors.textContent = ''
  }
  language.className = 'mojito-field'
  audio.className = 'mojito-field'
  const actions = element('div')
  actions.className = 'actions'
  actions.append(save, reset)
  form.append(language, audio)
  for (const config of catalog.configurations) {
    const row = element('label', `${config.name} `)
    row.className = 'mojito-field'
    const input = Object.keys(config.options).length ? element('select') : element('input')
    const value = draft.sets?.[config.setId]?.[config.id] ?? config.default
    if (input instanceof HTMLSelectElement) {
      for (const [label, value] of Object.entries(config.options)) {
        const option = element('option', label)
        option.value = value
        input.append(option)
      }
      input.value = String(value)
    } else {
      input.type = typeof value === 'boolean' ? 'checkbox' : typeof value === 'number' ? 'number' : 'text'
      if (input.type === 'checkbox') input.checked = Boolean(value)
      else input.value = String(value)
    }
    input.addEventListener('change', () => {
      touch()
      draft!.sets ??= {}
      draft!.sets[config.setId] ??= {}
      draft!.sets[config.setId]![config.id] =
        input instanceof HTMLInputElement && input.type === 'checkbox'
          ? input.checked
          : input instanceof HTMLInputElement && input.type === 'number'
            ? Number(input.value)
            : input.value
    })
    row.append(input)
    form.append(row)
  }
  form.append(actions)
  list.replaceChildren()
  for (const definition of catalog.definitions) {
    const diag = diagnostics.get(ruleKey(definition.setId, definition.triggerId))
    const row = element('details'),
      heading = element('summary', definition.triggerId),
      detail = element(
        'p',
        `${labels[diag?.state ?? 'unverified']} · 匹配 ${diag?.matches ?? 0} 次 · ${diag?.reason ?? '当前区域未运行'}`,
      )
    const ruleStatus = element('span', `${labels[diag?.state ?? 'unverified']} · ${diag?.matches ?? 0} 次`)
    ruleStatus.className = 'rule-status mojito-secondary'
    heading.append(ruleStatus)
    diagnosticRows.set(ruleKey(definition.setId, definition.triggerId), { status: ruleStatus, detail })
    detail.className = 'mojito-secondary'
    const config = () => {
      draft!.rules[definition.setId] ??= {}
      const group = draft!.rules[definition.setId]!
      group[definition.triggerId] ??= {}
      return group[definition.triggerId]!
    }
    const value = config()
    const enabled = element('input')
    enabled.type = 'checkbox'
    enabled.checked = value.enabled !== false
    enabled.onchange = () => {
      touch()
      config().enabled = enabled.checked
    }
    const label = element('label', '启用 ')
    label.append(enabled)
    const level = select(['default', 'info', 'alert', 'alarm'], value.level ?? 'default', (level) => {
      if (level === 'default') delete config().level
      else config().level = level as RuleConfig['level']
    })
    const ruleAudio = select(['default', 'tts', 'sound', 'none'], value.audio ?? 'default', (audio) => {
      if (audio === 'default') delete config().audio
      else config().audio = audio as RuleConfig['audio']
    })
    const original = element('pre', definition.original)
    const help = element(
      'p',
      '匹配覆盖需填写完整 type 和 netRegex，保留 ID、名称及其他约束。整行正则不能直接使用；清空可恢复原条件。',
    )
    const matching = element('textarea')
    matching.rows = 3
    matching.value = value.matching ? JSON.stringify(value.matching, null, 2) : ''
    matching.setAttribute('aria-label', `${definition.triggerId} 匹配覆盖`)
    matching.oninput = () => {
      touch()
      try {
        if (!matching.value.trim()) delete config().matching
        else config().matching = JSON.parse(matching.value)
        invalid.delete(matching)
        matching.removeAttribute('aria-invalid')
        errors.textContent = invalid.size ? '匹配覆盖不是有效 JSON' : ''
      } catch {
        invalid.add(matching)
        matching.setAttribute('aria-invalid', 'true')
        errors.textContent = '匹配覆盖不是有效 JSON'
        save.disabled = true
        return
      }
      save.disabled = invalid.size > 0
    }
    level.setAttribute('aria-label', `${definition.triggerId} 提示等级`)
    ruleAudio.setAttribute('aria-label', `${definition.triggerId} 音频`)
    row.append(heading, detail, label, level, ruleAudio, original, help, matching)
    list.append(row)
  }
  filter()
  for (const diagnostic of state.diagnostics.filter((row) => row.triggerId === '(timeline)'))
    list.append(element('p', `${diagnostic.setId} 时间轴：${diagnostic.state} ${diagnostic.reason}`))
}
const catalogSub = bridge.subscribe('raidboss-catalog', (batch) => {
  for (const value of batch.items) receiveCatalog(value as unknown as Catalog)
})
const sub = bridge.subscribe('raidboss', (batch) => {
  for (const value of batch.items) receive(value as unknown as State)
})
await Promise.all([catalogSub.ready, sub.ready])
receiveCatalog((await bridge.snapshot('raidboss-catalog')) as unknown as Catalog)
receive((await bridge.snapshot('raidboss')) as unknown as State)
