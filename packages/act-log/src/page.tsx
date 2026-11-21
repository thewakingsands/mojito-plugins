import { connectView } from '@ffcafe/mojito-plugin-sdk/view'
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { RecorderState, Status } from './recorder.js'
import './style.css'

const labels: Record<Status, string> = {
  idle: '尚未开始',
  choosing: '正在选择文件',
  waiting: '等待实时采集或回放',
  recording: '记录中',
  stopping: '正在写入最后一批',
  stopped: '已停止',
  incomplete: '记录不完整',
}
const view = connectView()
function Page() {
  const [state, setState] = useState<RecorderState>(),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false)
  useEffect(() => {
    let active = true
    const sub = view.then((v) => {
      if (!active) return
      const s = v.subscribe('recorder', (batch) => {
        const last = batch.items.at(-1)
        if (last && active) setState(last as RecorderState)
      })
      void s.ready.catch((e) => {
        if (active) setError(String(e))
      })
      return s
    })
    void sub.catch((e) => {
      if (active) setError(String(e))
    })
    return () => {
      active = false
      void sub.then(
        (s) => s?.dispose(),
        () => {},
      )
    }
  }, [])
  const running = state && ['waiting', 'recording', 'stopping'].includes(state.status)
  async function command() {
    setPending(true)
    setError('')
    try {
      await (await view).command('recorder', running ? 'stop' : 'start')
    } catch (e) {
      setError(String(e))
    } finally {
      setPending(false)
    }
  }
  return (
    <main>
      <h1>ACT 日志</h1>
      <p>当前版本尚未输出玩家标记和启动信息。含未支持聊天格式的记录会显示为不完整。</p>
      <p role="status">{state ? labels[state.status] : '正在连接'}</p>
      {state?.name && (
        <dl>
          <dt>文件</dt>
          <dd>{state.name}</dd>
          <dt>已写入</dt>
          <dd>{state.lines.toLocaleString()} 行</dd>
        </dl>
      )}
      <button
        type="button"
        disabled={!state || pending || state.status === 'choosing' || state.status === 'stopping'}
        onClick={() => void command()}
      >
        {running ? '停止记录' : '开始记录'}
      </button>
      {(error || state?.error) && <p role="alert">{error || state?.error}</p>}
    </main>
  )
}
createRoot(document.getElementById('root')!).render(<Page />)
