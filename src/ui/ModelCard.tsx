import type { Aggregates } from '../core/aggregate'
import { fmtCredit, fmtInt, fmtPct, fmtTokens } from '../core/format'
import { SOURCE_META } from '../core/types'
import type { Palette } from './theme'

export function ModelCard({
  agg,
  palette,
  focus,
  onFocus,
}: {
  agg: Aggregates
  palette: Palette
  focus: string | null
  onFocus: (key: string | null) => void
}) {
  const models = agg.models
  const focused = focus ? models.find((m) => m.key === focus) : undefined
  const dual = agg.days.some((d) => (d.bySource.codebuddy ?? 0) > 0) && agg.days.some((d) => (d.bySource.workbuddy ?? 0) > 0)
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h3>模型用量</h3>
          <div className="sub">{dual ? 'WorkBuddy 每次请求都记模型，CodeBuddy 只记在会话上 · 点击看细节' : '按会话记录的模型归类 · 点击看细节'}</div>
        </div>
        <div className="tools">{models.length} 个模型</div>
      </div>

      {models.length === 0 ? (
        <div className="empty-state">这个时间段没有模型用量</div>
      ) : (
        <>
          <div className="mhead">
            <span>模型</span>
            <span>占比</span>
            <span>Token</span>
            <span>积分</span>
            <span>命中</span>
          </div>
          <div className="mlist">
            {models.slice(0, 9).map((m, i) => {
              const color = palette.models[i % palette.models.length]
              const on = focus === m.key
              const cbTok = m.bySource.codebuddy ?? 0
              const wbTok = m.bySource.workbuddy ?? 0
              const srcTotal = cbTok + wbTok
              const mixed = dual && cbTok > 0 && wbTok > 0 && srcTotal > 0
              const fill = mixed
                ? { background: `linear-gradient(90deg, ${palette.models[0]} 0 ${(cbTok / srcTotal) * 100}%, ${palette.models[1]} ${(cbTok / srcTotal) * 100}% 100%)` }
                : { background: color }
              return (
                <div
                  key={m.key}
                  className={`mrow${on ? ' on' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => onFocus(on ? null : m.key)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') onFocus(on ? null : m.key)
                  }}
                  title={`${m.key}\nToken ${fmtInt(m.total)} · 请求 ${m.requests} · 会话 ${m.sessions}\n积分 ${fmtCredit(m.credit)} · 每百万 token ${m.creditPerMillion.toFixed(1)}\n缓存命中率 ${fmtPct(m.cacheHitRate)}${
                    srcTotal ? `\n${SOURCE_META.codebuddy.short} ${fmtTokens(cbTok)} · ${SOURCE_META.workbuddy.short} ${fmtTokens(wbTok)}` : ''
                  }`}
                >
                  <span className="nm">
                    <i style={{ background: color }} />
                    {m.key}
                  </span>
                  <span className="bar">
                    <span style={{ width: `${Math.max(1.5, m.share * 100)}%`, ...fill }} />
                  </span>
                  <span className="val">{fmtTokens(m.total)}</span>
                  <span className="val">{fmtCredit(m.credit)}</span>
                  <span className="rate">{fmtPct(m.cacheHitRate, 0)}</span>
                </div>
              )
            })}
          </div>
        </>
      )}

      <div className="card-foot">
        {focused ? (
          <>
            已聚焦 <b style={{ color: 'var(--ink)' }}>{focused.key}</b>：{fmtInt(focused.requests)} 次请求 · {focused.sessions} 个会话 · 单次均值 {fmtTokens(focused.avgPerRequest)} · 每百万
            token {focused.creditPerMillion.toFixed(1)} 积分（再次点击取消）
          </>
        ) : (
          <>
            {dual
              ? 'WorkBuddy 每次请求都带模型名，CodeBuddy 只记在会话上。「未记录模型」都来自 CodeBuddy 缺这个字段的会话，不猜。'
              : '模型来自会话里的记录。老会话没写模型名，就归到「未记录模型」，不猜。'}
          </>
        )}
      </div>
    </section>
  )
}
