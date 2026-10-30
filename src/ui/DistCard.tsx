import type { Aggregates } from '../core/aggregate'
import { fmtInt, fmtTokens } from '../core/format'
import type { Palette } from './theme'

function Ridge({ values, p50, color }: { values: number[]; p50: number; color: string }) {
  if (!values.length) return null
  const lo = Math.log10(Math.max(1, values[0]))
  const hi = Math.log10(Math.max(10, values[values.length - 1]))
  const span = Math.max(1e-6, hi - lo)
  const BINS = 34
  const bins = new Array(BINS).fill(0) as number[]
  for (const v of values) {
    const idx = Math.min(BINS - 1, Math.max(0, Math.floor(((Math.log10(Math.max(1, v)) - lo) / span) * BINS)))
    bins[idx] += 1
  }
  const smooth = bins.map((v, i) => ((bins[i - 1] ?? 0) + 2 * v + (bins[i + 1] ?? 0)) / 4)
  const max = Math.max(...smooth, 1e-9)
  const pts = smooth.map((v, i) => [((i + 0.5) / BINS) * 100, 23 - (v / max) * 19] as const)
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' ')
  const area = `M0 24 ${line.slice(1)} L100 24 Z`
  const p50x = ((Math.log10(Math.max(1, p50)) - lo) / span) * 100

  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" style={{ width: '100%', height: 28 }} aria-hidden="true">
      <path d={area} fill={color} opacity="0.16" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.1" vectorEffect="non-scaling-stroke" />
      <line x1={Math.max(0, Math.min(100, p50x))} y1="2" x2={Math.max(0, Math.min(100, p50x))} y2="24" stroke={color} strokeWidth="1" strokeDasharray="2 2" opacity="0.7" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export function DistCard({ agg, palette }: { agg: Aggregates; palette: Palette }) {
  const rows = agg.requestSizes.filter((r) => r.values.length > 1)
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h3>单次请求规模</h3>
          <div className="sub">按模型看每次请求的 token 分布（对数轴）。虚线是这条分布的中位数</div>
        </div>
        <div className="tools">{agg.requestCountInWindow} 次请求</div>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">当前窗口请求太少，无法形成分布</div>
      ) : (
        <div className="dist">
          {rows.map((r, i) => (
            <div className="dist-row" key={r.modelKey}>
              <span className="dname">{r.label}</span>
              <Ridge values={r.values} p50={r.p50} color={palette.models[i % palette.models.length]} />
              <span className="dval">
                {fmtTokens(r.p50)}
                <small>p50</small>
              </span>
              <span className="dval">
                {fmtTokens(r.p90)}
                <small>p90</small>
              </span>
              <span className="dcount">{fmtInt(r.values.length)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="card-foot">右列为该模型在窗口内的请求样本数；极端长尾请求会拉高 p90，适合作上下文预算参考。</div>
    </section>
  )
}
