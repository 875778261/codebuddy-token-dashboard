import type { Dataset, RequestRecord, SessionRecord } from './types'
import { addDays, dayList, localDateKey, projectName, startOfDay } from './format'

export type WindowPreset = '7' | '30' | '90' | 'all'

export interface WindowSpec {
  preset: WindowPreset
  label: string
  /** 含 */
  start: number
  /** 不含 */
  end: number
  prevStart: number
  prevEnd: number
  days: number
  custom?: { from: string; to: string }
}

export const UNKNOWN_MODEL = '未记录模型'

export function makeWindow(preset: WindowPreset, coverageFirst?: string, now = Date.now()): WindowSpec {
  const today = startOfDay(now)
  const end = addDays(today, 1)
  if (preset === 'all') {
    const first = coverageFirst ? new Date(`${coverageFirst}T00:00:00`).getTime() : addDays(today, -89)
    const start = Math.min(startOfDay(first), today)
    const days = Math.max(1, Math.round((end - start) / 86400000))
    return { preset, label: '全部', start, end, prevStart: start, prevEnd: start, days }
  }
  const n = Number(preset)
  const start = startOfDay(addDays(today, -(n - 1)))
  return {
    preset,
    label: `近 ${n} 天`,
    start,
    end,
    prevStart: addDays(start, -n),
    prevEnd: start,
    days: n,
  }
}

export function makeCustomWindow(from: string, to: string): WindowSpec {
  const start = new Date(`${from}T00:00:00`).getTime()
  const end = addDays(new Date(`${to}T00:00:00`).getTime(), 1)
  const days = Math.max(1, Math.round((end - start) / 86400000))
  return {
    preset: 'all',
    label: `${from.slice(5)} → ${to.slice(5)}`,
    start,
    end,
    prevStart: addDays(start, -days),
    prevEnd: start,
    days,
    custom: { from, to },
  }
}

export interface Totals {
  requests: number
  sessions: number
  total: number
  input: number
  output: number
  cache: number
  cacheMiss: number
  cacheWrite: number
  credit: number
  activeDays: number
  cacheHitRate: number
  avgPerRequest: number
  avgPerActiveDay: number
}

export interface DayPoint {
  key: string
  ts: number
  total: number
  input: number
  output: number
  cache: number
  cacheMiss: number
  credit: number
  requests: number
}

export interface ModelStat {
  key: string
  total: number
  requests: number
  credit: number
  input: number
  output: number
  cache: number
  cacheMiss: number
  cacheHitRate: number
  sessions: number
  share: number
  creditPerMillion: number
  avgPerRequest: number
}

export interface ProjectStat {
  key: string
  name: string
  path?: string
  total: number
  requests: number
  sessions: number
  credit: number
  lastTs: number
  share: number
  /** 与 days 对齐的每日 token，用于列表内迷你趋势 */
  sparkline: number[]
}

export interface SessionStat {
  session: SessionRecord
  total: number
  requests: number
  credit: number
  input: number
  output: number
  cache: number
  firstTs: number
  lastTs: number
  projectKey: string
  projectName: string
}

export interface RequestSizeRow {
  modelKey: string
  label: string
  values: number[]
  p50: number
  p90: number
  max: number
}

export interface Aggregates {
  window: WindowSpec
  totals: Totals
  prev?: Totals
  days: DayPoint[]
  models: ModelStat[]
  projects: ProjectStat[]
  sessions: SessionStat[]
  heat: number[][]
  requestSizes: RequestSizeRow[]
  typeSplit: { craft: number; ask: number; other: number }
  requestCountInWindow: number
  /** 与 days 对齐的每日各模型 token，用于"模型构成随时间变化" */
  modelDaily: Array<{ modelKey: string; values: number[] }>
}

const emptyTotals = (): Totals => ({
  requests: 0,
  sessions: 0,
  total: 0,
  input: 0,
  output: 0,
  cache: 0,
  cacheMiss: 0,
  cacheWrite: 0,
  credit: 0,
  activeDays: 0,
  cacheHitRate: 0,
  avgPerRequest: 0,
  avgPerActiveDay: 0,
})

function finalizeTotals(t: Totals, activeDays: number) {
  t.activeDays = activeDays
  t.cacheHitRate = t.input ? t.cache / t.input : 0
  t.avgPerRequest = t.requests ? t.total / t.requests : 0
  t.avgPerActiveDay = activeDays ? t.total / activeDays : 0
  return t
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))
  return sorted[idx]
}

export function modelLabel(session: SessionRecord): string {
  return session.modelId || UNKNOWN_MODEL
}

export function aggregate(dataset: Dataset, win: WindowSpec): Aggregates {
  const totals = emptyTotals()
  const dayMap = new Map<string, DayPoint>()
  const modelMap = new Map<string, ModelStat>()
  const projectMap = new Map<string, ProjectStat>()
  const sessionStats: SessionStat[] = []
  const heat: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0))
  const sizes = new Map<string, number[]>()
  const typeSplit = { craft: 0, ask: 0, other: 0 }
  const activeDaySet = new Set<string>()
  const modelDay = new Map<string, Map<string, number>>()
  const projectDay = new Map<string, Map<string, number>>()
  let requestCountInWindow = 0

  const inWindow = (ts: number) => ts >= win.start && ts < win.end

  for (const s of dataset.sessions) {
    const hit: RequestRecord[] = []
    for (const r of s.requests) if (inWindow(r.ts)) hit.push(r)
    if (!hit.length) continue

    const projectKey = s.cwd || s.projectId
    const pName = s.cwd ? projectName(s.cwd) : `项目 ${s.projectId.slice(0, 6)}`
    let sTotal = 0
    let sCredit = 0
    let sInput = 0
    let sOutput = 0
    let sCache = 0
    let firstTs = Number.POSITIVE_INFINITY
    let lastTs = 0
    const modelKey = modelLabel(s)

    for (const r of hit) {
      const dk = localDateKey(r.ts)
      const dt = new Date(r.ts)
      const day = dayMap.get(dk) ?? {
        key: dk,
        ts: startOfDay(r.ts),
        total: 0,
        input: 0,
        output: 0,
        cache: 0,
        cacheMiss: 0,
        credit: 0,
        requests: 0,
      }
      day.total += r.total
      day.input += r.input
      day.output += r.output
      day.cache += r.cache
      day.cacheMiss += r.cacheMiss
      day.credit += r.credit
      day.requests += 1
      dayMap.set(dk, day)
      activeDaySet.add(dk)

      const md = modelDay.get(modelKey) ?? new Map<string, number>()
      md.set(dk, (md.get(dk) ?? 0) + r.total)
      modelDay.set(modelKey, md)

      const pdl = projectDay.get(projectKey) ?? new Map<string, number>()
      pdl.set(dk, (pdl.get(dk) ?? 0) + r.total)
      projectDay.set(projectKey, pdl)

      heat[(dt.getDay() + 6) % 7][dt.getHours()] += r.total

      const model = modelMap.get(modelKey) ?? {
        key: modelKey,
        total: 0,
        requests: 0,
        credit: 0,
        input: 0,
        output: 0,
        cache: 0,
        cacheMiss: 0,
        cacheHitRate: 0,
        sessions: 0,
        share: 0,
        creditPerMillion: 0,
        avgPerRequest: 0,
      }
      model.total += r.total
      model.requests += 1
      model.credit += r.credit
      model.input += r.input
      model.output += r.output
      model.cache += r.cache
      model.cacheMiss += r.cacheMiss
      modelMap.set(modelKey, model)

      const bucket = sizes.get(modelKey)
      if (bucket) {
        if (bucket.length < 4000) bucket.push(r.total)
      } else {
        sizes.set(modelKey, [r.total])
      }

      sTotal += r.total
      sCredit += r.credit
      sInput += r.input
      sOutput += r.output
      sCache += r.cache
      if (r.ts < firstTs) firstTs = r.ts
      if (r.ts > lastTs) lastTs = r.ts

      totals.total += r.total
      totals.input += r.input
      totals.output += r.output
      totals.cache += r.cache
      totals.cacheMiss += r.cacheMiss
      totals.cacheWrite += r.cacheWrite
      totals.credit += r.credit
      totals.requests += 1
      requestCountInWindow += 1
      if (r.type === 'craft') typeSplit.craft += 1
      else if (r.type === 'ask') typeSplit.ask += 1
      else typeSplit.other += 1
    }

    const project = projectMap.get(projectKey) ?? {
      key: projectKey,
      name: pName,
      path: s.cwd,
      total: 0,
      requests: 0,
      sessions: 0,
      credit: 0,
      lastTs: 0,
      share: 0,
      sparkline: [],
    }
    project.total += sTotal
    project.requests += hit.length
    project.sessions += 1
    project.credit += sCredit
    project.lastTs = Math.max(project.lastTs, lastTs)
    projectMap.set(projectKey, project)

    sessionStats.push({
      session: s,
      total: sTotal,
      requests: hit.length,
      credit: sCredit,
      input: sInput,
      output: sOutput,
      cache: sCache,
      firstTs,
      lastTs,
      projectKey,
      projectName: pName,
    })
  }

  totals.sessions = sessionStats.length
  finalizeTotals(totals, activeDaySet.size)

  // 补齐窗口内没有数据的日子，让趋势图与覆盖率判断能看见"空档"
  const days: DayPoint[] = []
  const spanEnd = Math.min(win.end, Date.now() + 86400000)
  if (win.start < spanEnd) {
    for (const key of dayList(win.start, spanEnd - 1)) {
      days.push(dayMap.get(key) ?? { key, ts: new Date(`${key}T00:00:00`).getTime(), total: 0, input: 0, output: 0, cache: 0, cacheMiss: 0, credit: 0, requests: 0 })
    }
  }

  const models = [...modelMap.values()].sort((a, b) => b.total - a.total)
  for (const m of models) {
    m.cacheHitRate = m.input ? m.cache / m.input : 0
    m.share = totals.total ? m.total / totals.total : 0
    m.creditPerMillion = m.total ? (m.credit / m.total) * 1e6 : 0
    m.avgPerRequest = m.requests ? m.total / m.requests : 0
    m.sessions = sessionStats.filter((s) => modelLabel(s.session) === m.key).length
  }

  const projects = [...projectMap.values()].sort((a, b) => b.total - a.total)
  for (const p of projects) {
    p.share = totals.total ? p.total / totals.total : 0
    const byDay = projectDay.get(p.key)
    p.sparkline = days.map((d) => byDay?.get(d.key) ?? 0)
  }

  sessionStats.sort((a, b) => b.total - a.total)

  const modelDaily = models.map((m) => {
    const byDay = modelDay.get(m.key)
    return { modelKey: m.key, values: days.map((d) => byDay?.get(d.key) ?? 0) }
  })

  const requestSizes: RequestSizeRow[] = models.slice(0, 6).map((m) => {
    const values = (sizes.get(m.key) ?? []).slice().sort((a, b) => a - b)
    return {
      modelKey: m.key,
      label: m.key,
      values,
      p50: quantile(values, 0.5),
      p90: quantile(values, 0.9),
      max: values.length ? values[values.length - 1] : 0,
    }
  })

  const prev = computePrevTotals(dataset, win)

  return {
    window: win,
    totals,
    prev,
    days,
    models,
    projects,
    sessions: sessionStats,
    heat,
    requestSizes,
    typeSplit,
    requestCountInWindow,
    modelDaily,
  }
}

function computePrevTotals(dataset: Dataset, win: WindowSpec): Totals | undefined {
  if (win.preset === 'all' || win.prevEnd <= win.prevStart) return undefined
  const t = emptyTotals()
  const active = new Set<string>()
  for (const s of dataset.sessions) {
    let any = false
    for (const r of s.requests) {
      if (r.ts < win.prevStart || r.ts >= win.prevEnd) continue
      any = true
      t.requests += 1
      t.total += r.total
      t.input += r.input
      t.output += r.output
      t.cache += r.cache
      t.cacheMiss += r.cacheMiss
      t.credit += r.credit
      active.add(localDateKey(r.ts))
    }
    if (any) t.sessions += 1
  }
  if (!t.requests) return undefined
  return finalizeTotals(t, active.size)
}
