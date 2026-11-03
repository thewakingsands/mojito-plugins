import type { RegionHover } from './CurveLanes.js'
import { signedPercent } from './CurveLanes.js'
import type { ReasonKind } from './potency.js'
import { clockText } from './timeline.js'

const REASONS: Record<ReasonKind, string> = { raid: '团辅', self: '自身增益', target: '目标状态', down: '伤害降低' }

/** Why the damage per potency of a region strays from the baseline, above its block in the timeline */
export function RegionPopover(props: { hover: RegionHover; left: number; bottom: number }) {
  const { region, baseline, point } = props.hover
  const up = region.deviation > 0
  return (
    <div
      className="popover"
      role="dialog"
      aria-label="每威力伤害区域"
      style={{ left: props.left, bottom: props.bottom }}
    >
      <h4>
        {up ? '每威力伤害高于基准' : '每威力伤害低于基准'}
        <span className="popover-time number">{clockText(region.from)}</span>
      </h4>
      <table className="facts">
        <tbody>
          <tr>
            <th>时间</th>
            <td className="number">
              {clockText(region.from)} – {clockText(region.to)}
            </td>
          </tr>
          <tr>
            <th>偏离</th>
            <td className="number">{signedPercent(region.deviation)}</td>
          </tr>
          <tr>
            <th>中位数</th>
            <td className="number">
              {region.median.toFixed(1)}（基准 {baseline.toFixed(1)}）
            </td>
          </tr>
          <tr>
            <th>样本数</th>
            <td className="number">{region.count}</td>
          </tr>
          {point && (
            <tr>
              <th>最近样本</th>
              <td className="number">
                {clockText(point.t)} · 每威力 {point.r.toFixed(1)} · 窗口值{' '}
                {point.w === null ? '样本不足' : point.w.toFixed(1)}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <h5>原因</h5>
      <table className="facts">
        <tbody>
          {region.known.map((group) => (
            <tr key={group.kind}>
              <th>{REASONS[group.kind]}</th>
              <td>{group.names.join('、')}</td>
            </tr>
          ))}
          {region.unknown && (
            <>
              <tr>
                <td colSpan={2}>{region.unknown.kind === 'partly' ? '另有未知因素' : '原因未知'}</td>
              </tr>
              <tr>
                <th>自身</th>
                <td>{region.unknown.self.join('、') || '无'}</td>
              </tr>
              {region.unknown.boss && (
                <tr>
                  <th>首领</th>
                  <td>{region.unknown.boss.join('、') || '无'}</td>
                </tr>
              )}
            </>
          )}
        </tbody>
      </table>
    </div>
  )
}
