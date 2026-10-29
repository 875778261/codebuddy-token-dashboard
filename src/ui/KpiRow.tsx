import type { Aggregates } from '../core/aggregate'
import { fmtCredit, fmtInt, fmtPct, fmtTokens } from '../core/format'
import { Delta } from './widgets'

function Kpi({ label, value, unit, sub, delta }: { label: string; value: string; unit?: string; sub: string; delta?: React.ReactNode }) {
  return (
    <div className="kpi">
      <div className="k">
        {label} {delta}
      </div>
      <div className="v num">
        {value}
        {unit ? <small>{unit}</small> : null}
      </div>
      <div className="s">{sub}</div>
    </div>
  )
}

export function KpiRow({ agg }: { agg: Aggregates }) {
  const t = agg.totals
  const prev = agg.prev
  const creditPerM = t.total ? (t.credit / t.total) * 1e6 : 0
  const coverage = agg.days.length ? t.activeDays / agg.days.length : 0
  const avgSessions = t.sessions ? t.requests / t.sessions : 0

  return (
    <div className="grid kpis">
      <Kpi
        label="总 Token"
        value={fmtTokens(t.total)}
        sub={`输入 ${fmtTokens(t.input)} · 输出 ${fmtTokens(t.output)}`}
        delta={<Delta current={t.total} previous={prev?.total} />}
      />
      <Kpi
        label="缓存命中率"
        value={fmtPct(t.cacheHitRate)}
        sub={`命中 ${fmtTokens(t.cache)} · 未命中 ${fmtTokens(t.cacheMiss)}`}
      />
      <Kpi
        label="积分消耗"
        value={fmtCredit(t.credit)}
        sub={`每百万 token ≈ ${creditPerM.toFixed(1)} 积分`}
        delta={<Delta current={t.credit} previous={prev?.credit} />}
      />
      <Kpi
        label="请求数"
        value={fmtInt(t.requests)}
        sub={`单次均值 ${fmtTokens(t.avgPerRequest)} · craft ${fmtInt(agg.typeSplit.craft)} / ask ${fmtInt(agg.typeSplit.ask)}`}
        delta={<Delta current={t.requests} previous={prev?.requests} />}
      />
      <Kpi
        label="会话数"
        value={fmtInt(t.sessions)}
        sub={`平均每会话 ${avgSessions.toFixed(1)} 次请求`}
      />
      <Kpi
        label="活跃天数"
        value={String(t.activeDays)}
        unit={`/ ${agg.days.length} 天`}
        sub={`窗口覆盖率 ${fmtPct(coverage, 0)} · 有数据日均 ${fmtTokens(t.avgPerActiveDay)}`}
      />
    </div>
  )
}
