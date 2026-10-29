export const pad2 = (n: number) => String(n).padStart(2, '0')

export function localDateKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function dateKeyOf(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function addDays(ts: number, days: number): number {
  const d = new Date(ts)
  d.setDate(d.getDate() + days)
  return d.getTime()
}

export function dayList(startTs: number, endTs: number): string[] {
  const out: string[] = []
  let cur = startOfDay(startTs)
  const end = startOfDay(endTs)
  while (cur <= end) {
    out.push(localDateKey(cur))
    cur = addDays(cur, 1)
  }
  return out
}

/** 879462435 → 8.79 亿；12345 → 1.23 万 */
export function fmtTokens(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e8) return `${(n / 1e8).toFixed(2)} 亿`
  if (abs >= 1e4) return `${(n / 1e4).toFixed(abs >= 1e6 ? 0 : 1)} 万`
  return String(Math.round(n))
}

export function fmtTokenParts(n: number): { value: string; unit: string } {
  const abs = Math.abs(n)
  if (abs >= 1e8) return { value: (n / 1e8).toFixed(2), unit: '亿' }
  if (abs >= 1e4) return { value: (n / 1e4).toFixed(abs >= 1e6 ? 0 : 1), unit: '万' }
  return { value: String(Math.round(n)), unit: '' }
}

export const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US')

export function fmtCredit(n: number): string {
  if (n >= 1e4) return `${(n / 1e4).toFixed(2)} 万`
  if (n >= 100) return n.toFixed(1)
  if (n >= 10) return n.toFixed(1)
  return n.toFixed(2)
}

export const fmtPct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`

export function fmtDateTime(ts: number): string {
  const d = new Date(ts)
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export function fmtTime(ts: number): string {
  const d = new Date(ts)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export function fmtDayLabel(key: string): string {
  return key.slice(5)
}

/** 项目名：优先取路径最后一段 */
export function projectName(cwd?: string, fallback?: string): string {
  if (!cwd) return fallback ?? '未知项目'
  const norm = cwd.replace(/\\/g, '/').replace(/\/+$/, '')
  const seg = norm.split('/').filter(Boolean)
  return seg[seg.length - 1] || fallback || cwd
}

export function ellipsizeMiddle(s: string, max = 42): string {
  if (s.length <= max) return s
  const keep = Math.floor((max - 1) / 2)
  return `${s.slice(0, keep)}…${s.slice(-keep)}`
}
