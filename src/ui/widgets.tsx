import { useGSAP } from '@gsap/react'
import { gsap } from 'gsap'
import { useId, useRef } from 'react'
import { fmtTokens } from '../core/format'
import { isReducedMotion } from './motion'

/**
 * 数字滚动：值变化时从上一次的值补间到新值。
 * 只改文本，不产生布局动画；减少动效偏好下直接落到终值。
 */
export function CountUp({
  value,
  format,
  duration = 1.1,
}: {
  value: number
  format: (v: number) => string
  duration?: number
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const from = useRef(0)
  const fmt = useRef(format)
  fmt.current = format

  useGSAP(
    () => {
      const el = ref.current
      if (!el) return
      const target = Number.isFinite(value) ? value : 0

      if (isReducedMotion()) {
        el.textContent = fmt.current(target)
        from.current = target
        return
      }

      const proxy = { v: from.current }
      el.textContent = fmt.current(proxy.v)
      const tween = gsap.to(proxy, {
        v: target,
        duration,
        ease: 'power2.out',
        onUpdate: () => {
          el.textContent = fmt.current(proxy.v)
        },
        onComplete: () => {
          from.current = target
        },
      })

      return () => {
        tween.kill()
        from.current = proxy.v
      }
    },
    { dependencies: [value], scope: ref },
  )

  return <span ref={ref}>{fmt.current(Number.isFinite(value) ? value : 0)}</span>
}

export function Sparkline({ values, color, height = 22 }: { values: number[]; color: string; height?: number }) {
  const id = useId().replace(/:/g, '')
  const max = Math.max(...values, 1)
  const n = Math.max(values.length, 2)
  const pts = values.map((v, i) => [(i / (n - 1)) * 100, height - (v / max) * (height - 2) - 1] as const)
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' ')
  const area = `${line} L100 ${height} L0 ${height} Z`
  return (
    <svg className="sparkline" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={`sp${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sp${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export function Delta({ current, previous, invert = false }: { current: number; previous?: number; invert?: boolean }) {
  if (previous === undefined || previous <= 0) return null
  const ratio = (current - previous) / previous
  if (!Number.isFinite(ratio)) return null
  const up = ratio >= 0
  const good = invert ? !up : up
  return (
    <span className={`delta ${good ? 'up' : 'down'}`} title={`对比上一个同样长的区间：${(previous / 1e6).toFixed(2)}M → ${(current / 1e6).toFixed(2)}M`}>
      {up ? '↑' : '↓'}
      {Math.abs(ratio * 100).toFixed(0)}%
    </span>
  )
}

export function CoverageStrip({ days, missing }: { days: string[]; missing: Set<string> }) {
  return (
    <div className="coverage-strip" role="img" aria-label="数据覆盖情况">
      {days.map((d) => (
        <i key={d} className={missing.has(d) ? 'void' : ''} title={missing.has(d) ? `${d} · 无记录` : `${d} · 有记录`} />
      ))}
    </div>
  )
}

export function MiniTip({ children }: { children: React.ReactNode }) {
  return <span title="">{children}</span>
}

export function TokenValue({ value, compact = true }: { value: number; compact?: boolean }) {
  if (!compact) return <>{Math.round(value).toLocaleString('en-US')}</>
  return <>{fmtTokens(value)}</>
}
