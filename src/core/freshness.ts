import { pad2, startOfDay } from './format'
import { SOURCE_ORDER, type Dataset, type SourceId } from './types'

/** 逐源新鲜度：`at` 是该源自己的扫描时间，`fresh` 表示它属于最近一轮扫描 */
export interface SourceFreshness {
  at: string
  fresh: boolean
}

/**
 * 推导逐源新鲜度。
 *
 * **fresh 只由 `touched`（本会话真的扫过它的时间）决定，不看切片自带的 `scannedAt`**：
 * 后者可能是几天前写进 IndexedDB 的缓存。此前的误导点正是把「合并后扫描时间取各源最大值」
 * 当成了本次刷新时间——只重扫一端时，另一端看起来也变新了。
 *
 * 同一轮扫描的各源由调用方传同一个时间戳，因此这里用相等判定即可，不需要容差。
 */
export function deriveFreshness(
  slices: Partial<Record<SourceId, Dataset>>,
  touched: Partial<Record<SourceId, number>>,
): Partial<Record<SourceId, SourceFreshness>> {
  const loaded = SOURCE_ORDER.filter((s) => Boolean(slices[s]))
  const stamps = loaded.map((s) => touched[s]).filter((t): t is number => typeof t === 'number')
  const latest = stamps.length ? Math.max(...stamps) : null
  const out: Partial<Record<SourceId, SourceFreshness>> = {}
  for (const s of loaded) {
    const slice = slices[s]!
    out[s] = {
      // 逐源时间优先：合并视图的 sources.scannedAt 是各源最大值，不能用来表示单端
      at: slice.bySource?.[s]?.info.scannedAt || slice.sources?.scannedAt || '',
      fresh: latest !== null && touched[s] === latest,
    }
  }
  return out
}

const MINUTE = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

/**
 * 扫描时间的相对文案：
 * 刚刚 / N 分钟前 / 今天 12:04 / 昨天 18:20 / N 天前 / 09-01 12:04 / 2025-12-31 23:05。
 * 「今天 / 昨天」按本机时区判断，不按 UTC。
 */
export function describeWhen(iso: string, now: number = Date.now()): string {
  const ts = Date.parse(iso)
  if (!Number.isFinite(ts)) return '时间未知'
  const diff = now - ts
  // 负值来自另一台机器的快照或几秒的时钟漂移：一律当刚刚，不显示「-1 分钟前」
  if (diff < 45_000) return '刚刚'
  if (diff < HOUR) return `${Math.max(1, Math.floor(diff / MINUTE))} 分钟前`

  const d = new Date(ts)
  const hhmm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  const dayDiff = Math.round((startOfDay(now) - startOfDay(ts)) / DAY)
  if (dayDiff <= 0) return `今天 ${hhmm}`
  if (dayDiff === 1) return `昨天 ${hhmm}`
  if (dayDiff < 7) return `${dayDiff} 天前`

  const md = `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${hhmm}`
  return new Date(now).getFullYear() === d.getFullYear() ? md : `${d.getFullYear()}-${md}`
}
