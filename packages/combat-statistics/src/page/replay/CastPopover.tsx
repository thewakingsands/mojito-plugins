import type { ReplayCast, ReplayData } from '../../view-model.js'
import { SkillIcon } from '../icons.js'
import { actionName, actorName } from './parts.js'
import { clockText } from './timeline.js'

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} 秒`
const outcome = (cast: ReplayCast) =>
  cast.cancelledAt === null
    ? '完成'
    : `在 ${clockText(cast.cancelledAt)} 被打断或取消，读了 ${seconds(cast.cancelledAt - cast.t)}`

/** The details of an enemy's cast, above its bar in the timeline */
export function CastPopover(props: {
  data: ReplayData
  cast: ReplayCast
  left: number
  bottom: number
  popover: React.RefObject<HTMLDivElement | null>
}) {
  const { data, cast } = props
  const casts = data.casts
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.actor === cast.actor && item.actionId === cast.actionId)
  return (
    <div
      className="popover"
      ref={props.popover}
      role="dialog"
      aria-label="读条详情"
      style={{ left: props.left, bottom: props.bottom }}
    >
      <h4>
        <SkillIcon skill={`action:${cast.actionId}`} />
        {actionName(data, cast.actionId, cast.name)}
        <span className="popover-time number">{clockText(cast.t)}</span>
      </h4>
      <table className="facts">
        <tbody>
          <tr>
            <th>技能 ID</th>
            <td className="number">
              {cast.actionId}（0x{cast.actionId.toString(16).toUpperCase()}）
            </td>
          </tr>
          <tr>
            <th>读条者</th>
            <td>{actorName(data.actors[cast.actor])}</td>
          </tr>
          <tr>
            <th>开始</th>
            <td className="number">{clockText(cast.t)}</td>
          </tr>
          <tr>
            <th>读条时长</th>
            <td className="number">{seconds(cast.durationMs)}</td>
          </tr>
          <tr>
            <th>预计结束</th>
            <td className="number">{clockText(cast.t + cast.durationMs)}</td>
          </tr>
          <tr>
            <th>结果</th>
            <td>{outcome(cast)}</td>
          </tr>
        </tbody>
      </table>
      <h5>这个技能在本场的读条</h5>
      <table className="hits">
        <tbody>
          {casts.map(({ item, index }) => (
            <tr key={index} className={item === cast ? 'current' : undefined}>
              <td className="number">{clockText(item.t)}</td>
              <td className="number">{seconds(item.durationMs)}</td>
              <td>{item.cancelledAt === null ? '完成' : '被打断或取消'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
