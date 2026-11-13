import { CircleHelp } from 'lucide-react'
import { useId } from 'react'

const KEYS: [string, string][] = [
  ['空格', '播放和暂停'],
  ['左、右方向键', '后退和前进 5 秒'],
  ['滚轮', '平移时间轴'],
  ['在刻度上拖动', '选取时间段'],
  ['点击读条或事件', '查看详情'],
  ['Esc', '关闭详情'],
]

/** What the keys, the wheel and the presses on the timeline do, in a popover the browser places and closes */
export function Help() {
  const id = useId(),
    tip = useId()
  return (
    <>
      <button
        type="button"
        data-icon
        data-variant="ghost"
        aria-label="操作说明"
        aria-haspopup="dialog"
        popoverTarget={id}
        interestfor={tip}
      >
        <CircleHelp />
      </button>
      <span id={tip} popover="hint">
        操作说明
      </span>
      <div id={id} className="help" popover="auto" role="dialog" aria-label="操作说明">
        <table>
          <tbody>
            {KEYS.map(([key, what]) => (
              <tr key={key}>
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
