import { useState } from 'react'
import { type Scope, type Settings, settings as validate } from '../model.js'
import { useBridge, useChannel } from '../page/bridge.js'
import type { StatisticsState } from '../view-model.js'

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function SettingsPage() {
  const statistics = useChannel<StatisticsState>('statistics')
  // The form starts from the saved settings and keeps the user's edits until they are saved.
  const [draft, setDraft] = useState<Omit<Settings, 'quietSeconds'> & { quietSeconds: string }>()
  const saved = statistics?.settings
  const form = draft ?? (saved && { ...saved, quietSeconds: String(saved.quietSeconds) })
  const [saveState, setSaveState] = useState<{ ok: boolean; text: string } | null>(null)
  const [clearState, setClearState] = useState<{ ok: boolean; text: string } | null>(null)
  const { command } = useBridge()
  if (!form) return <p className="placeholder">正在读取设置</p>
  const edit = (patch: Partial<typeof form>) => {
    setDraft({ ...form, ...patch })
    setSaveState(null)
  }
  const save = async () => {
    try {
      const value = validate({ ...form, quietSeconds: Number(form.quietSeconds) })
      await command({ kind: 'settings', value })
      setDraft(undefined)
      setSaveState({ ok: true, text: '已保存' })
    } catch (error) {
      setSaveState({ ok: false, text: message(error) })
    }
  }
  const clear = async () => {
    try {
      await command({ kind: 'clear' })
      setClearState({ ok: true, text: '已清空' })
    } catch (error) {
      setClearState({ ok: false, text: `清空失败：${message(error)}` })
    }
  }
  return (
    <div className="settings-page">
      <form
        className="mojito-panel"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <div className="mojito-field">
          <div>
            <label htmlFor="mode">分场方式</label>
            <small>自动：真实脱战时结束，读不到战斗状态时按敌对活动静默结束。手动保持：不自动拆分。</small>
          </div>
          <select
            id="mode"
            value={form.mode}
            onChange={(event) => edit({ mode: event.target.value as Settings['mode'] })}
          >
            <option value="auto">自动</option>
            <option value="manual">手动保持</option>
          </select>
        </div>
        <div className="mojito-field">
          <div>
            <label htmlFor="quiet">敌对活动静默</label>
            <small>3～120 秒。等待的时间不计入战斗时长。</small>
          </div>
          <span className="unit">
            <input
              id="quiet"
              type="number"
              min={3}
              max={120}
              value={form.quietSeconds}
              onChange={(event) => edit({ quietSeconds: event.target.value })}
            />
            秒
          </span>
        </div>
        <div className="mojito-field">
          <div>
            <label htmlFor="scope">解析范围</label>
            <small>统计哪些玩家的数据。</small>
          </div>
          <select id="scope" value={form.scope} onChange={(event) => edit({ scope: event.target.value as Scope })}>
            <option value="party">小队</option>
            <option value="alliance">团队</option>
            <option value="all">所有人</option>
          </select>
        </div>
        <div className="mojito-field">
          <div>
            <label htmlFor="pets">合并宠物</label>
            <small>把宠物的伤害和治疗计入主人。</small>
          </div>
          <input
            id="pets"
            type="checkbox"
            checked={form.mergePets}
            onChange={(event) => edit({ mergePets: event.target.checked })}
          />
        </div>
      </form>
      <div className="mojito-panel">
        <div className="mojito-field">
          <div>
            <span>清空历史记录</span>
            <small>删除除当前进本以外的全部战斗日志。</small>
            {clearState && <small className={clearState.ok ? undefined : 'error'}>{clearState.text}</small>}
          </div>
          <button type="button" data-variant="danger" onClick={() => void clear()}>
            清空
          </button>
        </div>
      </div>
      <div className="actions">
        {saveState && <span className={saveState.ok ? 'hint' : 'error'}>{saveState.text}</span>}
        <button type="button" data-variant="primary" onClick={() => void save()}>
          保存设置
        </button>
      </div>
    </div>
  )
}
