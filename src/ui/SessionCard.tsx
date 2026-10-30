import { useEffect, useMemo, useState } from 'react'
import type { Aggregates, SessionStat } from '../core/aggregate'
import { fmtCredit, fmtDateTime, fmtInt, fmtTokens } from '../core/format'
import { SOURCE_META } from '../core/types'
import type { Palette } from './theme'
import { Chart } from './Chart'

type SortKey = 'total' | 'requests' | 'credit' | 'last'

const COLUMNS: Array<{ key: SortKey | null; label: string; align?: 'l' }> = [
  { key: null, label: '会话', align: 'l' },
  { key: null, label: '项目', align: 'l' },
  { key: null, label: '模型' },
  { key: 'requests', label: '请求' },
  { key: 'total', label: 'Token' },
  { key: 'credit', label: '积分' },
  { key: 'last', label: '最近' },
]

export function SessionCard({
  agg,
  palette,
  modelFocus,
  onClearFocus,
}: {
  agg: Aggregates
  palette: Palette
  modelFocus: string | null
  onClearFocus: () => void
}) {
  const [sortKey, setSortKey] = useState<SortKey>('total')
  const [asc, setAsc] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    setSelectedId(null)
  }, [agg, modelFocus])

  const rows = useMemo(() => {
    const list = modelFocus ? agg.sessions.filter((s) => s.models.includes(modelFocus)) : [...agg.sessions]
    list.sort((a, b) => {
      const pick = (s: SessionStat) => (sortKey === 'last' ? s.lastTs : sortKey === 'requests' ? s.requests : sortKey === 'credit' ? s.credit : s.total)
      const diff = pick(a) - pick(b)
      return asc ? diff : -diff
    })
    return list
  }, [agg, sortKey, asc, modelFocus])

  const selected = selectedId ? agg.sessions.find((s) => s.session.id === selectedId) : undefined

  const scatterOption = useMemo(() => {
    if (!selected) return {}
    const reqs = selected.session.requests.filter((r) => r.ts >= agg.window.start && r.ts < agg.window.end)
    const color = palette.dark ? '#7f8bff' : '#4f5df0'
    return {
      grid: { left: 54, right: 12, top: 14, bottom: 22 },
      tooltip: {
        backgroundColor: palette.dark ? 'rgba(20,25,35,.96)' : 'rgba(255,255,255,.97)',
        borderColor: palette.line,
        textStyle: { color: palette.ink, fontSize: 11 },
        formatter: (p: unknown) => {
          const pt = p as { value: number[] }
          const [ts, total, input, output, cache, credit] = pt.value
          return `${fmtDateTime(ts)}<br/>合计 <b>${fmtInt(total)}</b><br/>输入 ${fmtInt(input)} · 输出 ${fmtInt(output)}<br/>缓存命中 ${fmtInt(cache)} · 积分 ${Number(credit).toFixed(2)}`
        },
      },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: palette.line } },
        axisLabel: { color: palette.ink4, fontSize: 9 },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'log',
        min: 1000,
        axisLine: { show: false },
        splitLine: { lineStyle: { color: palette.grid } },
        axisLabel: { color: palette.ink4, fontSize: 9, formatter: (v: number) => fmtTokens(v) },
      },
      series: [
        {
          type: 'scatter',
          symbolSize: 7,
          itemStyle: { color, opacity: 0.75 },
          data: reqs.map((r) => [r.ts, r.total, r.input, r.output, r.cache, r.credit]),
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: palette.ink4, type: 'dashed', width: 1 },
            label: { color: palette.ink4, fontSize: 9, formatter: '均值' },
            data: [{ yAxis: selected.total / reqs.length }],
          },
        },
      ],
    }
  }, [selected, agg.window, palette])

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h3>会话明细</h3>
          <div className="sub">点一行展开每次请求的散点和明细</div>
        </div>
        <div className="tools">
          {modelFocus ? (
            <span className="tag" style={{ cursor: 'pointer' }} onClick={onClearFocus} title="清除模型筛选">
              {modelFocus} ×
            </span>
          ) : null}
          {rows.length > 30 ? `显示前 30 / 共 ${rows.length}` : `共 ${rows.length} 个会话`}
        </div>
      </div>

      <div className="table-wrap">
        <table className="sessions">
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.label}
                  className={c.align === 'l' ? 'l' : ''}
                  onClick={() => {
                    if (!c.key) return
                    if (c.key === sortKey) setAsc(!asc)
                    else {
                      setSortKey(c.key)
                      setAsc(false)
                    }
                  }}
                >
                  {c.label}
                  {c.key === sortKey ? (asc ? ' ↑' : ' ↓') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 30).map((s) => {
              const on = s.session.id === selectedId
              return (
                <tr key={s.session.id} className={on ? 'on' : ''} onClick={() => setSelectedId(on ? null : s.session.id)}>
                  <td className="l">
                    <span className="session-title">
                      <span className={`src-tag ${s.session.source}`}>{SOURCE_META[s.session.source].short}</span>
                      {s.session.isSubAgent ? <span className="tag sub">sub</span> : null}
                      {s.session.source === 'codebuddy' ? <span className={`tag ${s.session.type === 'ask' ? 'ask' : 'craft'}`}>{s.session.type}</span> : null}
                      <span>{s.session.title || '（无标题会话）'}</span>
                    </span>
                  </td>
                  <td className="l">{s.projectName}</td>
                  <td title={s.models.join(' · ')}>
                    {s.modelKey}
                    {s.models.length > 1 ? <small className="multi"> +{s.models.length - 1}</small> : null}
                  </td>
                  <td>{fmtInt(s.requests)}</td>
                  <td>{fmtTokens(s.total)}</td>
                  <td>{fmtCredit(s.credit)}</td>
                  <td>{fmtDateTime(s.lastTs)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {rows.length === 0 ? <div className="empty-state">这个时间段没有会话</div> : null}
      </div>

      {selected ? (
        <div className="detail">
          <div className="detail-head">
            <div>
              <h4>{selected.session.title || '（无标题会话）'}</h4>
              <div className="meta">
                <span className={`src-tag ${selected.session.source}`}>{SOURCE_META[selected.session.source].short}</span>
                {selected.projectName}
                {selected.session.cwd ? ` · ${selected.session.cwd}` : ''} · {selected.models.join(' · ') || '未记录模型'} ·{' '}
                {fmtDateTime(selected.firstTs)} → {fmtDateTime(selected.lastTs)}
              </div>
            </div>
            <div className="meta">
              {fmtInt(selected.requests)} 次请求 · 合计 <b style={{ color: 'var(--ink)' }}>{fmtTokens(selected.total)}</b> · 积分 {fmtCredit(selected.credit)}
            </div>
          </div>
          <div className="detail-grid">
            <Chart option={scatterOption} height={240} ariaLabel="会话请求散点图" />
            <div className="req-wrap">
              <table className="req">
                <thead>
                  <tr>
                    <th className="l">时间</th>
                    <th className="l">模型 / 类型</th>
                    <th>输入</th>
                    <th>输出</th>
                    <th>缓存</th>
                    <th>积分</th>
                    <th>合计</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.session.requests
                    .filter((r) => r.ts >= agg.window.start && r.ts < agg.window.end)
                    .slice()
                    .reverse()
                    .map((r, i) => (
                      <tr key={r.key ?? `${r.ts}-${i}`}>
                        <td className="l">{fmtDateTime(r.ts)}</td>
                        <td className="l">{r.model ?? r.type}</td>
                        <td>{fmtInt(r.input)}</td>
                        <td>{fmtInt(r.output)}</td>
                        <td>{fmtInt(r.cache)}</td>
                        <td>{r.credit.toFixed(2)}</td>
                        <td>{fmtInt(r.total)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
