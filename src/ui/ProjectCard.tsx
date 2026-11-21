import type { Aggregates } from '../core/aggregate'
import { fmtInt, fmtPct, fmtTokens } from '../core/format'
import { SOURCE_META, SOURCE_ORDER } from '../core/types'
import type { Palette } from './theme'
import { Sparkline } from './widgets'

export function ProjectCard({ agg, palette }: { agg: Aggregates; palette: Palette }) {
  const projects = agg.projects.slice(0, 9)
  const rest = agg.projects.length - projects.length
  const color = palette.dark ? '#7f8bff' : '#4f5df0'

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h3>项目分布</h3>
          <div className="sub">
            {agg.projects.some((p) => p.path) ? '按文件夹路径归类（斜杠统一，大小写照原样）。标「多源」是这些源都用过这个项目' : '没拿到项目路径，先按记录里的项目标识归类'}
          </div>
        </div>
        <div className="tools">{agg.projects.length} 个项目</div>
      </div>

      {projects.length === 0 ? (
        <div className="empty-state">这个时间段没有项目数据</div>
      ) : (
        <div className="plist">
          {projects.map((p) => {
            // 不写死两源：CLI 与 IDE 同属一个端，但仍是两个源，判定要逐源看
            const srcs = SOURCE_ORDER.filter((s) => (p.bySource[s] ?? 0) > 0)
            return (
            <div className="prow" key={p.key} title={p.path ?? p.name}>
              <div className="nm">
                {p.name}
                {srcs.length > 1 ? (
                  <span className="badge both" title={srcs.map((s) => SOURCE_META[s].label).join(' + ')}>
                    多源
                  </span>
                ) : null}
                {p.path ? <em>{p.path.replace(/[\\/][^\\/]+$/, '') || '/'}</em> : null}
              </div>
              <Sparkline values={p.sparkline} color={color} />
              <div className="val">
                {fmtTokens(p.total)}
                <small>
                  {fmtPct(p.share, 1)} · {p.sessions} 会话 · {fmtInt(p.requests)} 请求
                </small>
              </div>
            </div>
            )
          })}
        </div>
      )}
      <div className="card-foot">
        {rest > 0 ? `另有 ${rest} 个项目未展示。` : '每个项目右侧的曲线是这段时间每天的 token。'}
      </div>
    </section>
  )
}
