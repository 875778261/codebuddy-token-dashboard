import { useMemo } from 'react'
import type { Aggregates } from '../core/aggregate'
import { fmtInt, fmtPct, fmtTokens } from '../core/format'
import { SOURCE_META, SOURCE_ORDER } from '../core/types'
import type { Palette } from './theme'
import { Chart } from './Chart'

export type TrendMode = 'usage' | 'cache' | 'model' | 'source'

const MODEL_LIMIT = 6

const MODES: Array<{ key: TrendMode; label: string }> = [
  { key: 'usage', label: 'Token 构成' },
  { key: 'cache', label: '缓存构成' },
  { key: 'model', label: '模型构成' },
  { key: 'source', label: '端构成' },
]

interface TipRow {
  label: string
  value: string
  color?: string
}

function tipHtml(header: string, rows: TipRow[]) {
  const body = rows
    .map(
      (r) =>
        (r.color ? `<span style="display:inline-block;width:7px;height:7px;border-radius:2px;background:${r.color};margin-right:5px"></span>` : '') +
        `${r.label}&nbsp;&nbsp;<b>${r.value}</b>`,
    )
    .join('<br/>')
  return `<div style="font-weight:600;margin-bottom:4px">${header}</div><div style="line-height:1.7">${body}</div>`
}

export function TrendCard({
  agg,
  palette,
  mode,
  onMode,
}: {
  agg: Aggregates
  palette: Palette
  mode: TrendMode
  onMode: (m: TrendMode) => void
}) {
  const option = useMemo(() => {
    const days = agg.days
    const labels = days.map((d) => d.key.slice(5))
    const dense = days.length > 45

    // 空档日（历史的空洞）用背景色块标出来，而不是把折线连过去
    const gapAreas = (() => {
      const out: Array<Array<{ xAxis: string }>> = []
      let start: number | null = null
      days.forEach((d, i) => {
        if (!d.requests) {
          if (start === null) start = i
        } else if (start !== null) {
          out.push([{ xAxis: labels[start] }, { xAxis: labels[i - 1] }])
          start = null
        }
      })
      if (start !== null) out.push([{ xAxis: labels[start] }, { xAxis: labels[labels.length - 1] }])
      return out
    })()

    const tooltipBase = {
      trigger: 'axis' as const,
      backgroundColor: palette.dark ? 'rgba(20,25,35,.96)' : 'rgba(255,255,255,.97)',
      borderColor: palette.line,
      borderWidth: 1,
      padding: [8, 11] as [number, number],
      textStyle: { color: palette.ink, fontSize: 11 },
      axisPointer: { type: 'shadow' as const, shadowStyle: { color: palette.dark ? 'rgba(255,255,255,.05)' : 'rgba(15,23,42,.05)' } },
    }

    const xAxis = {
      type: 'category' as const,
      data: labels,
      boundaryGap: true,
      axisLine: { lineStyle: { color: palette.line } },
      axisTick: { show: false },
      axisLabel: { color: palette.ink4, fontSize: 9.5, interval: dense ? Math.ceil(days.length / 10) : 0, hideOverlap: true },
    }
    const grid = { left: 54, right: 46, top: 16, bottom: 24 }
    const valueAxis = {
      type: 'value' as const,
      splitLine: { lineStyle: { color: palette.grid } },
      axisLabel: { color: palette.ink4, fontSize: 9.5, formatter: (v: number) => fmtTokens(v) },
    }
    const pctAxis = {
      type: 'value' as const,
      max: 100,
      splitLine: { lineStyle: { color: palette.grid } },
      axisLabel: { color: palette.ink4, fontSize: 9.5, formatter: '{value}%' },
    }
    const rightAxis = {
      type: 'value' as const,
      position: 'right' as const,
      splitLine: { show: false },
      axisLabel: { color: palette.ink4, fontSize: 9.5, formatter: (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v))) },
    }

    const axisTooltip = (kind: 'token' | 'cache' | 'model') => ({
      ...tooltipBase,
      formatter: (params: unknown) => {
        const arr = (Array.isArray(params) ? params : [params]) as Array<{
          dataIndex: number
          seriesName: string
          color: string
          value: number | { raw?: number }
        }>
        if (!arr.length) return ''
        const idx = arr[0].dataIndex
        const day = days[idx]
        const rows = arr
          .map((p) => {
            const raw = typeof p.value === 'object' && p.value ? (p.value.raw ?? 0) : Number(p.value)
            const isRate = p.seriesName === '积分' || p.seriesName === '命中率'
            return {
              label: p.seriesName,
              value: isRate ? raw.toFixed(1) + (p.seriesName === '命中率' ? '%' : '') : fmtInt(raw),
              color: p.color,
              raw,
            }
          })
          .sort((a, b) => (kind === 'model' ? Number(b.raw) - Number(a.raw) : 0))
        const header =
          kind === 'cache'
            ? `${day.key} · 命中率 ${day.input ? fmtPct(day.cache / day.input) : '—'}`
            : `${day.key} · 合计 ${fmtTokens(day.total)}`
        return tipHtml(header, rows)
      },
    })

    if (mode === 'usage') {
      const stackSeries = (name: string, key: 'cache' | 'cacheMiss' | 'output', color: string, radius: number[] | 0) => ({
        name,
        type: 'bar',
        stack: 'tk',
        barMaxWidth: 26,
        itemStyle: { color, borderRadius: radius },
        emphasis: { focus: 'series' },
        data: days.map((d) => d[key]),
      })
      return {
        grid,
        xAxis,
        yAxis: [valueAxis, rightAxis],
        tooltip: axisTooltip('token'),
        series: [
          {
            ...stackSeries('缓存命中', 'cache', palette.cache, 0),
            markArea: {
              silent: true,
              itemStyle: { color: palette.dark ? 'rgba(255,255,255,.05)' : 'rgba(15,23,42,.05)' },
              data: gapAreas,
            },
          },
          stackSeries('缓存未命中', 'cacheMiss', palette.miss, 0),
          stackSeries('输出', 'output', palette.output, [3, 3, 0, 0]),
          {
            name: '积分',
            type: 'line',
            yAxisIndex: 1,
            symbol: 'none',
            smooth: 0.3,
            lineStyle: { width: 1.5, color: palette.credit },
            itemStyle: { color: palette.credit },
            data: days.map((d) => Math.round(d.credit * 100) / 100),
          },
        ],
      }
    }

    if (mode === 'cache') {
      const total = (i: number) => days[i].input || 1
      return {
        grid,
        xAxis,
        yAxis: [pctAxis],
        tooltip: axisTooltip('cache'),
        series: [
          {
            name: '缓存命中',
            type: 'bar',
            stack: 'cache',
            barMaxWidth: 26,
            itemStyle: { color: palette.cache, borderRadius: 0 },
            data: days.map((d, i) => ({ value: Number(((d.cache / total(i)) * 100).toFixed(2)), raw: d.cache })),
            markArea: {
              silent: true,
              itemStyle: { color: palette.dark ? 'rgba(255,255,255,.05)' : 'rgba(15,23,42,.05)' },
              data: gapAreas,
            },
          },
          {
            name: '缓存未命中',
            type: 'bar',
            stack: 'cache',
            barMaxWidth: 26,
            itemStyle: { color: palette.miss, borderRadius: [3, 3, 0, 0] },
            data: days.map((d, i) => ({ value: Number(((d.cacheMiss / total(i)) * 100).toFixed(2)), raw: d.cacheMiss })),
          },
          {
            name: '命中率',
            type: 'line',
            symbol: 'none',
            smooth: 0.3,
            lineStyle: { width: 1.6, color: palette.credit },
            itemStyle: { color: palette.credit },
            data: days.map((d) => (d.input ? Number(((d.cache / d.input) * 100).toFixed(1)) : null)),
          },
        ],
      }
    }

    if (mode === 'source') {
      const sources = SOURCE_ORDER.filter((s) => days.some((d) => (d.bySource[s] ?? 0) > 0))
      const colorOf = (s: (typeof SOURCE_ORDER)[number]) => (s === 'codebuddy' ? palette.models[0] : palette.models[1])
      return {
        grid,
        xAxis,
        yAxis: [valueAxis],
        tooltip: axisTooltip('token'),
        series: sources.map((s, i) => ({
          name: SOURCE_META[s].label,
          type: 'bar',
          stack: 'src',
          barMaxWidth: 26,
          itemStyle: { color: colorOf(s), borderRadius: i === sources.length - 1 ? [3, 3, 0, 0] : 0 },
          emphasis: { focus: 'series' },
          data: days.map((d) => d.bySource[s] ?? 0),
          ...(i === 0
            ? {
                markArea: {
                  silent: true,
                  itemStyle: { color: palette.dark ? 'rgba(255,255,255,.04)' : 'rgba(15,23,42,.04)' },
                  data: gapAreas,
                },
              }
            : {}),
        })),
      }
    }

    const top = agg.modelDaily.slice(0, MODEL_LIMIT)
    const topKeys = new Set(top.map((m) => m.modelKey))
    const others = days.map((_, i) => agg.modelDaily.filter((m) => !topKeys.has(m.modelKey)).reduce((a, m) => a + (m.values[i] ?? 0), 0))
    const totalByDay = days.map((d) => d.total || 1)
    const shareData = (values: number[]) => values.map((v, i) => ({ value: Number(((v / totalByDay[i]) * 100).toFixed(2)), raw: v }))

    const series: Array<Record<string, unknown>> = top.map((m, i) => ({
      name: m.modelKey,
      type: 'bar',
      stack: 'md',
      barMaxWidth: 26,
      itemStyle: { color: palette.models[i % palette.models.length], borderRadius: i === 0 ? [3, 3, 0, 0] : 0 },
      emphasis: { focus: 'series' },
      data: shareData(m.values),
    }))
    if (others.some((v) => v > 0)) {
      series.push({
        name: '其他模型',
        type: 'bar',
        stack: 'md',
        barMaxWidth: 26,
        itemStyle: { color: palette.ink4, borderRadius: 0 },
        data: shareData(others),
      })
    }
    return {
      grid,
      xAxis,
      yAxis: [pctAxis, rightAxis],
      tooltip: axisTooltip('model'),
      series,
    }
  }, [agg, palette, mode])

  const legend =
    mode === 'usage'
      ? [
          { label: '缓存命中', color: palette.cache },
          { label: '缓存未命中', color: palette.miss },
          { label: '输出', color: palette.output },
          { label: '积分（右轴）', color: palette.credit },
        ]
      : mode === 'cache'
        ? [
            { label: '缓存命中', color: palette.cache },
            { label: '未命中', color: palette.miss },
            { label: '命中率', color: palette.credit },
          ]
        : mode === 'source'
          ? SOURCE_ORDER.filter((s) => agg.days.some((d) => (d.bySource[s] ?? 0) > 0)).map((s) => ({
              label: SOURCE_META[s].label,
              color: s === 'codebuddy' ? palette.models[0] : palette.models[1],
            }))
          : agg.modelDaily.slice(0, MODEL_LIMIT).map((m, i) => ({ label: m.modelKey, color: palette.models[i % palette.models.length] }))

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h3>每日用量</h3>
          <div className="sub">
            {mode === 'usage'
              ? 'Token 按 缓存／未命中／输出 三段堆叠，折线为积分'
              : mode === 'cache'
                ? '输入 token 的缓存命中构成（按比例）与命中率'
                : mode === 'source'
                  ? '每日 Token 按数据源堆叠：一眼看出什么时候换了工具'
                  : '每日 Token 的模型构成（按比例）'}
          </div>
        </div>
        <div className="tools">
          <div className="seg">
            {MODES.map((m) => (
              <button key={m.key} type="button" aria-pressed={mode === m.key} onClick={() => onMode(m.key)}>
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="chart-fill">
        <Chart option={option} height="fill" ariaLabel="每日用量趋势图" />
      </div>
      <div className="legend-row" style={{ marginTop: 6 }}>
        {legend.map((l) => (
          <span key={l.label}>
            <i style={{ background: l.color }} />
            {l.label}
          </span>
        ))}
        <span style={{ color: 'var(--ink-4)' }}>灰色区段 = 当日无记录（不是数据缺口）</span>
      </div>
    </section>
  )
}
