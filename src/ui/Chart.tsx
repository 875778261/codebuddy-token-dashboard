import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { BarChart, LineChart, ScatterChart } from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  BarChart,
  LineChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  CanvasRenderer,
])

type Option = Parameters<echarts.ECharts['setOption']>[0]

export function Chart({
  option,
  height,
  onEvents,
  ariaLabel,
}: {
  option: Option
  height: number
  onEvents?: Record<string, (params: unknown) => void>
  ariaLabel?: string
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const inst = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    if (!ref.current) return
    const chart = echarts.init(ref.current, undefined, { renderer: 'canvas' })
    inst.current = chart
    const ro = new ResizeObserver(() => chart.resize())
    ro.observe(ref.current)
    return () => {
      ro.disconnect()
      chart.dispose()
      inst.current = null
    }
  }, [])

  useEffect(() => {
    if (!inst.current) return
    // replaceMerge：坐标系数量会随模式变化（1 轴 / 2 轴），整块替换而不是增量合并
    inst.current.setOption(option, { notMerge: false, replaceMerge: ['series', 'xAxis', 'yAxis'] })
  }, [option])

  useEffect(() => {
    const chart = inst.current
    if (!chart || !onEvents) return
    for (const [name, handler] of Object.entries(onEvents)) {
      chart.off(name)
      chart.on(name, handler as (params: unknown) => void)
    }
    return () => {
      for (const name of Object.keys(onEvents)) chart.off(name)
    }
  }, [onEvents])

  return <div ref={ref} style={{ width: '100%', height }} role="img" aria-label={ariaLabel} />
}
