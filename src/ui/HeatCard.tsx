import { Fragment, useState } from 'react'
import type { Aggregates } from '../core/aggregate'
import { fmtInt, fmtPct, fmtTokens } from '../core/format'
import { heatColor, type Palette } from './theme'

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const BANDS = [
  { label: '凌晨 0-6', from: 0, to: 6 },
  { label: '上午 6-12', from: 6, to: 12 },
  { label: '下午 12-18', from: 12, to: 18 },
  { label: '晚间 18-24', from: 18, to: 24 },
]

export function HeatCard({ agg, palette }: { agg: Aggregates; palette: Palette }) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)
  const max = Math.max(1, ...agg.heat.flat())
  const dayTotals = agg.heat.map((row) => row.reduce((a, b) => a + b, 0))
  const grand = dayTotals.reduce((a, b) => a + b, 0) || 1

  const level = (v: number) => (v <= 0 ? 0 : Math.max(1, Math.min(7, Math.ceil(Math.sqrt(v / max) * 7))))

  const bandTotals = BANDS.map((b) => dayTotals.reduce((acc, _, wi) => acc + agg.heat[wi].slice(b.from, b.to).reduce((x, y) => x + y, 0), 0))

  return (
    <section className="card" onMouseLeave={() => setTip(null)}>
      <div className="card-head">
        <div>
          <h3>时段分布</h3>
          <div className="sub">星期 × 小时 · 这段时间的 token 密度</div>
        </div>
        <div className="heat-scale">
          <span>少</span>
          {[1, 2, 3, 4, 5, 6, 7].map((l) => (
            <i key={l} style={{ background: heatColor(palette, l) }} />
          ))}
          <span>多</span>
        </div>
      </div>

      <div className="heat-x">
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h}>{h % 3 === 0 ? h : ''}</span>
        ))}
      </div>
      <div className="heat">
        {agg.heat.map((row, wi) => (
          <Fragment key={WEEKDAYS[wi]}>
            <span className="hlab">{WEEKDAYS[wi]}</span>
            {row.map((v, h) => (
              <div
                key={`${wi}-${h}`}
                className="hcell"
                style={{ background: heatColor(palette, level(v)) }}
                onMouseMove={(e) => {
                  const share = dayTotals[wi] ? v / dayTotals[wi] : 0
                  setTip({
                    x: e.clientX,
                    y: e.clientY,
                    text: `${WEEKDAYS[wi]} ${String(h).padStart(2, '0')}:00–${String(h + 1).padStart(2, '0')}:00\n${fmtInt(v)} token（占该星期 ${fmtPct(share)}）`,
                  })
                }}
              />
            ))}
          </Fragment>
        ))}
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 6, marginTop: 12 }}>
        {BANDS.map((b, i) => (
          <div key={b.label} className="check" style={{ padding: '6px 8px' }}>
            <div className="k">{b.label}</div>
            <div className="v" style={{ fontSize: 12 }}>
              {fmtPct(bandTotals[i] / grand, 1)}
            </div>
          </div>
        ))}
      </div>
      <div className="card-foot">累计 {fmtTokens(agg.totals.total)} token · 最高单格 {fmtTokens(max)}</div>

      {tip ? (
        <div
          style={{
            position: 'fixed',
            left: tip.x + 12,
            top: tip.y + 12,
            zIndex: 100,
            pointerEvents: 'none',
            background: palette.dark ? 'rgba(20,25,35,.96)' : 'rgba(255,255,255,.97)',
            border: `1px solid ${palette.line}`,
            color: palette.ink,
            borderRadius: 9,
            padding: '7px 10px',
            fontSize: 11,
            whiteSpace: 'pre',
            lineHeight: 1.6,
            boxShadow: '0 12px 30px -14px rgba(0,0,0,.5)',
          }}
        >
          {tip.text}
        </div>
      ) : null}
    </section>
  )
}
