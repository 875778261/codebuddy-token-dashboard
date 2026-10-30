import { useEffect, useState } from 'react'
import { describeWhen, type SourceFreshness } from '../core/freshness'
import { SOURCE_META, SOURCE_ORDER, type SourceId } from '../core/types'

/** 相对时间每 30s 自己走一格；刷新频率远低于视觉可感，且只重绘这一小块 */
const TICK_MS = 30_000

/**
 * 顶栏常驻的逐源新鲜度：一眼看出「哪个源是本次刷新、哪个是沿用缓存、各自什么时候扫的」。
 * 自己在叶子节点里跑计时器，避免为了一行文案把整页图表重渲染。
 */
export function FreshnessChips({ freshness }: { freshness: Partial<Record<SourceId, SourceFreshness>> }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS)
    return () => window.clearInterval(timer)
  }, [])

  const rows = SOURCE_ORDER.filter((s) => freshness[s])
  if (!rows.length) return null

  return (
    <div className="meta meta-fresh">
      {rows.map((s) => {
        const f = freshness[s]!
        return (
          <span
            key={s}
            className={`fresh-chip${f.fresh ? ' fresh' : ''}`}
            title={`${SOURCE_META[s].label} · 扫描于 ${f.at || '未知'}${f.fresh ? '（本次刷新）' : '（沿用缓存）'}`}
          >
            <i className={`src-dot ${s}`} aria-hidden="true" />
            <span className="fc-name">{SOURCE_META[s].label}</span>
            {/* 状态词在前、时间在后：读起来是「WorkBuddy 缓存 · 昨天 18:20」，
                不会出现「刚刚」+「缓存」并列导致的矛盾感 */}
            <em>{f.fresh ? '本次刷新' : '缓存'}</em>
            <b>{describeWhen(f.at, now)}</b>
          </span>
        )
      })}
    </div>
  )
}
