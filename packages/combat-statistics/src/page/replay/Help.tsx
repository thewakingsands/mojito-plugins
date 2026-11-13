import { CircleHelp } from 'lucide-react'
import { type ReactNode, useId, useState } from 'react'

const KEYS: [ReactNode, string][] = [
  [<kbd key="space">空格</kbd>, '播放和暂停'],
  [
    <>
      <kbd>←</kbd> <kbd>→</kbd>
    </>,
    '后退和前进 5 秒',
  ],
  ['滚轮', '平移时间轴'],
  ['在刻度上拖动', '选取时间段'],
  ['点击读条或事件', '查看详情'],
  [<kbd key="esc">Esc</kbd>, '关闭详情'],
]

/** What the keys, the wheel and the presses on the timeline do, in a popover the browser places and closes */
export function Help() {
  const id = useId(),
    tip = useId()
  // The hint of the button would stay over the open popover
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        data-icon
        data-variant="ghost"
        aria-label="操作说明"
        aria-haspopup="dialog"
        popoverTarget={id}
        interestfor={open ? undefined : tip}
      >
        <CircleHelp />
      </button>
      <span id={tip} popover="hint">
        操作说明
      </span>
      <div
        id={id}
        className="help"
        popover="auto"
        role="dialog"
        aria-label="操作说明"
        onToggle={(toggle) => {
          const opened = (toggle.nativeEvent as ToggleEvent).newState === 'open'
          setOpen(opened)
          if (opened) document.getElementById(tip)?.hidePopover?.()
        }}
      >
        <table>
          <tbody>
            {KEYS.map(([key, what]) => (
              <tr key={what}>
                <th className="help-key">{key}</th>
                <td className="help-what">{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
