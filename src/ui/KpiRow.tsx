import type { Aggregates } from '../core/aggregate'
import { fmtCredit, fmtInt, fmtPct, fmtTokens } from '../core/format'
import { SOURCE_META, SOURCE_ORDER } from '../core/types'
import { CountUp, Delta } from './widgets'

function Kpi({ label, value, unit, sub, delta }: { label: string; value: React.ReactNode; unit?: string; sub: React.ReactNode; delta?: React.ReactNode }) {
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

/** 一行小字：把合并数字拆回两端（只有双端时出现） */
function SourceSplit({ agg }: { agg: Aggregates }) {
  const total = agg.totals.total
  const parts = SOURCE_ORDER.map((s) => ({ s, v: agg.days.reduce((a, d) => a + (d.bySource[s] ?? 0), 0) })).filter((p) => p.v > 0)
  if (parts.length < 2 || !total) return null
  return (
    <span className="split-line">
      {parts.map((p) => (
        <span key={p.s}>
          <i className={`src-dot ${p.s}`} />
          {SOURCE_META[p.s].short} {fmtPct(p.v / total, 0)}
        </span>
      ))}
    </span>
  )
}

export function KpiRow({ agg }: { agg: Aggregates }) {
  const t = agg.totals
  const prev = agg.prev
  const creditPerM = t.total ? (t.credit / t.total) * 1e6 : 0
  const coverage = agg.days.length ? t.activeDays / agg.days.length : 0
  const avgSessions = t.mainSessions ? t.requests / t.mainSessions : 0
  const creditCoverage = t.requests ? t.creditKnownRequests / t.requests : 0
  const hasModes = agg.typeSplit.craft + agg.typeSplit.ask > 0

  return (
    <div className="grid kpis">
      <Kpi
        label="总 Token"
        value={<CountUp value={t.total} format={fmtTokens} />}
        sub={
          <>
            输入 {fmtTokens(t.input)} · 输出 {fmtTokens(t.output)}
            <SourceSplit agg={agg} />
          </>
        }
        delta={<Delta current={t.total} previous={prev?.total} />}
      />
      <Kpi
        label="缓存命中率"
        value={<CountUp value={t.cacheHitRate} format={(v) => fmtPct(v, 1)} />}
        sub={`命中 ${fmtTokens(t.cache)} · 未命中 ${fmtTokens(t.cacheMiss)}`}
      />
      <Kpi
        label="已知积分"
        value={<CountUp value={t.credit} format={fmtCredit} />}
        sub={
          <>
            {fmtPct(creditCoverage, 0)} 请求有积分 · 每百万 token ≈ {creditPerM.toFixed(1)}
          </>
        }
        delta={<Delta current={t.credit} previous={prev?.credit} />}
      />
      <Kpi
        label="请求数"
        value={<CountUp value={t.requests} format={fmtInt} />}
        sub={
          hasModes
            ? `单次均值 ${fmtTokens(t.avgPerRequest)} · craft ${fmtInt(agg.typeSplit.craft)} / ask ${fmtInt(agg.typeSplit.ask)}`
            : `单次均值 ${fmtTokens(t.avgPerRequest)} · 主会话 ${fmtInt(t.mainSessions)} / subagent ${fmtInt(t.subAgentSessions)}`
        }
        delta={<Delta current={t.requests} previous={prev?.requests} />}
      />
      <Kpi
        label="会话数"
        value={<CountUp value={t.sessions} format={fmtInt} />}
        sub={
          t.subAgentSessions
            ? `主会话 ${fmtInt(t.mainSessions)} · subagent ${fmtInt(t.subAgentSessions)} · 每主会话 ${avgSessions.toFixed(1)} 次请求`
            : `平均每会话 ${avgSessions.toFixed(1)} 次请求`
        }
      />
      <Kpi
        label="活跃天数"
        value={<CountUp value={t.activeDays} format={(v) => String(Math.round(v))} duration={0.8} />}
        unit={`/ ${agg.days.length} 天`}
        sub={`有记录的天占 ${fmtPct(coverage, 0)} · 日均 ${fmtTokens(t.avgPerActiveDay)}`}
      />
    </div>
  )
}
