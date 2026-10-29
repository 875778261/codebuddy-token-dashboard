import type { Aggregates } from '../core/aggregate'
import { fmtInt, fmtPct, fmtTokens } from '../core/format'
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
            {agg.projects.some((p) => p.path) ? '按会话 cwd 聚合（来自 codebuddy-sessions.vscdb）' : '未提供会话库，暂按 history 项目 hash 聚合'}
          </div>
        </div>
        <div className="tools">{agg.projects.length} 个项目</div>
      </div>

      {projects.length === 0 ? (
        <div className="empty-state">当前窗口没有项目数据</div>
      ) : (
        <div className="plist">
          {projects.map((p) => (
            <div className="prow" key={p.key} title={p.path ?? p.name}>
              <div className="nm">
                {p.name}
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
          ))}
        </div>
      )}
      <div className="card-foot">
        {rest > 0 ? `另有 ${rest} 个项目未展示。` : '每个项目右侧的曲线是该窗口内的每日 token。'}
      </div>
    </section>
  )
}
