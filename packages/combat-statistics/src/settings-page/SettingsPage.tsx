import { useRef, useState } from 'react'
import { type Scope, type Settings, settings as validate } from '../model.js'
import { useBridge, useChannel } from '../page/bridge.js'
import type { StatisticsState } from '../view-model.js'

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function SettingsPage() {
  const statistics = useChannel<StatisticsState>('statistics')
  // The last settings sent; shown until a save fails, so the controls do not jump back before the channel publishes them.
  const [local, setLocal] = useState<Settings | null>(null)
  const [quietText, setQuietText] = useState<string | null>(null)
  const [quietError, setQuietError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [clearState, setClearState] = useState<{ ok: boolean; text: string } | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const { command } = useBridge()
  const shown = local ?? statistics?.settings
  if (!shown) return <p className="placeholder">正在读取设置</p>
  // The worker handles the commands in the order they arrive, so successive changes need no queue here.
  const save = async (value: Settings) => {
    setLocal(value)
    try {
      await command({ kind: 'settings', value })
      setSaveError(null)
    } catch (error) {
      setLocal(null)
      setSaveError(message(error))
    }
  }
  const commitQuiet = () => {
    if (quietText === null) return
    if (quietText === String(shown.quietSeconds)) {
      setQuietText(null)
      setQuietError(null)
      return
    }
    let value: Settings
    try {
      value = validate({ ...shown, quietSeconds: Number(quietText) })
    } catch (error) {
      setQuietError(message(error))
      return
    }
    setQuietText(null)
    setQuietError(null)
    void save(value)
  }
  const clear = async () => {
    // Closing the dialog does not stop the command; its result shows under 清空历史记录.
    dialog.current!.close()
    try {
      await command({ kind: 'clear' })
      setClearState({ ok: true, text: '已清空' })
    } catch (error) {
      setClearState({ ok: false, text: `清空失败：${message(error)}` })
    }
  }
  return (
    <div className="settings-page">
      {saveError && (
        <p className="mojito-callout" data-tone="danger">
          保存失败：{saveError}
        </p>
      )}
      <div className="mojito-panel">
        <div className="mojito-field">
          <div>
            <label htmlFor="quiet">脱战判定时间</label>
            <small>无法获取战斗状态时，超过该时长没有敌对行动即结束战斗。等待的时间不计入战斗时长。</small>
            {quietError && (
              <small id="quiet-error" className="error">
                {quietError}
              </small>
            )}
          </div>
          <span className="unit">
            <input
              id="quiet"
              type="number"
              min={3}
              max={120}
              value={quietText ?? shown.quietSeconds}
              aria-invalid={quietError ? true : undefined}
              aria-describedby={quietError ? 'quiet-error' : undefined}
              onChange={(event) => setQuietText(event.target.value)}
              onBlur={commitQuiet}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitQuiet()
              }}
            />
            秒
          </span>
        </div>
        <div className="mojito-field">
          <div>
            <label htmlFor="scope">解析范围</label>
            <small>统计哪些玩家的数据。</small>
          </div>
          <select
            id="scope"
            value={shown.scope}
            onChange={(event) => void save({ ...shown, scope: event.target.value as Scope })}
          >
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
            role="switch"
            aria-checked={shown.mergePets}
            checked={shown.mergePets}
            onChange={(event) => void save({ ...shown, mergePets: event.target.checked })}
          />
        </div>
        <div className="mojito-field">
          <div>
            <label htmlFor="telemetry">共享匿名状态样本</label>
            <small>
              {statistics?.telemetryAvailable
                ? '战后共享异常倍率及版本信息，不包含角色身份。开启后从下一场开始。'
                : '请先在宿主的插件权限中允许网络请求。'}
            </small>
          </div>
          <input
            id="telemetry"
            type="checkbox"
            role="switch"
            aria-checked={!!shown.telemetryEnabled}
            checked={!!shown.telemetryEnabled}
            disabled={!statistics?.telemetryAvailable}
            onChange={(event) => void save({ ...shown, telemetryEnabled: event.target.checked })}
          />
        </div>
      </div>
      <div className="mojito-panel">
        <div className="mojito-field">
          <div>
            <span>清空历史记录</span>
            <small>删除除当前进本以外的全部战斗日志。</small>
            {clearState && <small className={clearState.ok ? undefined : 'error'}>{clearState.text}</small>}
          </div>
          <button
            type="button"
            data-variant="danger"
            onClick={() => {
              dialog.current!.showModal()
              // showModal does not pick the autoFocus of React, which only focuses on mount.
              cancel.current!.focus()
            }}
          >
            清空
          </button>
        </div>
      </div>
      <dialog id="clear-dialog" ref={dialog} aria-labelledby="clear-dialog-title">
        <header>
          <h2 id="clear-dialog-title">清空历史记录</h2>
          <p>将删除除当前进本以外的全部战斗日志，删除后无法恢复。</p>
        </header>
        <footer>
          <button type="button" ref={cancel} onClick={() => dialog.current!.close()}>
            取消
          </button>
          <button type="button" data-variant="danger" onClick={() => void clear()}>
            清空
          </button>
        </footer>
      </dialog>
    </div>
  )
}
