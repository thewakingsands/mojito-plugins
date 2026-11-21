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
      <header>
        <div>
          <h1>ACT 日志</h1>
          <p role="status">{state ? labels[state.status] : '正在连接'}</p>
        </div>
        <button
          type="button"
          data-variant={running ? undefined : 'primary'}
          data-size="large"
          aria-busy={pending || state?.status === 'stopping'}
          disabled={!state || pending || state.status === 'choosing' || state.status === 'stopping'}
          onClick={() => void command()}
        >
          {running ? '停止记录' : '开始记录'}
        </button>
      </header>
      {state?.name && (
        <dl>
          <dt>文件</dt>
          <dd>{state.name}</dd>
          <dt>已写入</dt>
          <dd>{state.lines.toLocaleString()} 行</dd>
        </dl>
      )}
      <small>当前版本尚未记录玩家标记和启动信息。遇到未支持的聊天格式时，会停止记录并保留已写内容。</small>
      {(error || state?.error) && (
        <p className="mojito-callout" data-tone="danger" role="alert">
          {error || state?.error}
        </p>
      )}
    </main>
  )
}
createRoot(document.getElementById('root')!).render(<Page />)
