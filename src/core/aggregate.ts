import type { Dataset, RequestRecord, SessionRecord, SourceId } from './types'
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
  /** 有请求的主会话数（不含 subagent 会话） */
  mainSessions: number
  /** 有请求的 subagent 会话数 */
  subAgentSessions: number
  total: number
  input: number
  output: number
  cache: number
  cacheMiss: number
  cacheWrite: number
  credit: number
  /** credit 字段真实存在的请求数：积分覆盖率的分子 */
  creditKnownRequests: number
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
  /** 当日各源 token，用于「按端构成」堆叠与切换节奏 */
  bySource: Partial<Record<SourceId, number>>
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
  /** 该模型在窗口内出现过的会话数（请求级归属，一个会话可属于多个模型） */
  sessions: number
  share: number
  creditPerMillion: number
  avgPerRequest: number
  bySource: Partial<Record<SourceId, number>>
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
  /** 该项目在各源上的 token，用于「两端都用」标识 */
  bySource: Partial<Record<SourceId, number>>
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
  /** 窗口内 token 最多的模型（明细行展示用） */
  modelKey: string
  /** 窗口内出现过的全部请求级模型 */
  models: string[]
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
  /** 这份聚合结果覆盖的源；undefined = 合并视图 */
  source?: SourceId
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

export interface AggregateOptions {
  /** 只聚合某个源（切片视图）；不传 = 合并视图 */
  source?: SourceId
}

const emptyTotals = (): Totals => ({
  requests: 0,
  sessions: 0,
  mainSessions: 0,
  subAgentSessions: 0,
  total: 0,
  input: 0,
  output: 0,
  cache: 0,
  cacheMiss: 0,
  cacheWrite: 0,
  credit: 0,
  creditKnownRequests: 0,
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

/** 会话级模型标签：没有请求级模型可用时的回落值 */
export function modelLabel(session: SessionRecord): string {
  return session.modelId || UNKNOWN_MODEL
}

/**
 * 请求级优先的模型归属：WorkBuddy 每条请求自带 model，
 * CodeBuddy 只有会话级 selectedModelId，因此按请求回落。
 */
export function requestModel(session: SessionRecord, r: RequestRecord): string {
  return r.model || session.modelId || UNKNOWN_MODEL
}

export function aggregate(dataset: Dataset, win: WindowSpec, opts: AggregateOptions = {}): Aggregates {
  const sourceFilter = opts.source
  const totals = emptyTotals()
  const dayMap = new Map<string, DayPoint>()
  const modelMap = new Map<string, ModelStat>()
  const modelSessions = new Map<string, Set<string>>()
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
    if (sourceFilter && s.source !== sourceFilter) continue
    const hit: RequestRecord[] = []
    for (const r of s.requests) if (inWindow(r.ts)) hit.push(r)
    if (!hit.length) continue

    const projectKey = s.projectKey || s.cwd || s.projectId
    const pName = s.cwd ? projectName(s.cwd) : `项目 ${s.projectId.slice(0, 6)}`
    let sTotal = 0
    let sCredit = 0
    let sInput = 0
    let sOutput = 0
    let sCache = 0
    let firstTs = Number.POSITIVE_INFINITY
    let lastTs = 0
    const sessionModels = new Map<string, number>()

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
        bySource: {},
      }
      day.total += r.total
      day.input += r.input
      day.output += r.output
      day.cache += r.cache
      day.cacheMiss += r.cacheMiss
      day.credit += r.credit
      day.requests += 1
      day.bySource[s.source] = (day.bySource[s.source] ?? 0) + r.total
      dayMap.set(dk, day)
      activeDaySet.add(dk)

      const modelKey = requestModel(s, r)
      sessionModels.set(modelKey, (sessionModels.get(modelKey) ?? 0) + r.total)

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
        bySource: {},
      }
      model.total += r.total
      model.requests += 1
      model.credit += r.credit
      model.input += r.input
      model.output += r.output
      model.cache += r.cache
      model.cacheMiss += r.cacheMiss
      model.bySource[s.source] = (model.bySource[s.source] ?? 0) + r.total
      modelMap.set(modelKey, model)
      const ms = modelSessions.get(modelKey) ?? new Set<string>()
      ms.add(s.id)
      modelSessions.set(modelKey, ms)

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
      if (r.creditKnown !== false) totals.creditKnownRequests += 1
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
      bySource: {},
    }
    project.total += sTotal
    project.requests += hit.length
    project.sessions += 1
    project.credit += sCredit
    project.lastTs = Math.max(project.lastTs, lastTs)
    project.bySource[s.source] = (project.bySource[s.source] ?? 0) + sTotal
    projectMap.set(projectKey, project)

    let dominant = UNKNOWN_MODEL
    let dominantTotal = -1
    for (const [key, value] of sessionModels) {
      if (value > dominantTotal) {
        dominant = key
        dominantTotal = value
      }
    }

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
      modelKey: dominant,
      models: [...sessionModels.keys()].sort((a, b) => (sessionModels.get(b) ?? 0) - (sessionModels.get(a) ?? 0)),
    })
  }

  totals.sessions = sessionStats.length
  totals.subAgentSessions = sessionStats.filter((s) => s.session.isSubAgent).length
  totals.mainSessions = totals.sessions - totals.subAgentSessions
  finalizeTotals(totals, activeDaySet.size)

  // 补齐窗口内没有数据的日子，让趋势图与覆盖率判断能看见"空档"
  const days: DayPoint[] = []
  const spanEnd = Math.min(win.end, Date.now() + 86400000)
  if (win.start < spanEnd) {
    for (const key of dayList(win.start, spanEnd - 1)) {
      days.push(dayMap.get(key) ?? { key, ts: new Date(`${key}T00:00:00`).getTime(), total: 0, input: 0, output: 0, cache: 0, cacheMiss: 0, credit: 0, requests: 0, bySource: {} })
    }
  }

  const models = [...modelMap.values()].sort((a, b) => b.total - a.total)
  for (const m of models) {
    m.cacheHitRate = m.input ? m.cache / m.input : 0
    m.share = totals.total ? m.total / totals.total : 0
    m.creditPerMillion = m.total ? (m.credit / m.total) * 1e6 : 0
    m.avgPerRequest = m.requests ? m.total / m.requests : 0
    m.sessions = modelSessions.get(m.key)?.size ?? 0
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

  const prev = computePrevTotals(dataset, win, sourceFilter)

  return {
    window: win,
    source: sourceFilter,
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

function computePrevTotals(dataset: Dataset, win: WindowSpec, sourceFilter?: SourceId): Totals | undefined {
  if (win.preset === 'all' || win.prevEnd <= win.prevStart) return undefined
  const t = emptyTotals()
  const active = new Set<string>()
  for (const s of dataset.sessions) {
    if (sourceFilter && s.source !== sourceFilter) continue
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
      if (r.creditKnown !== false) t.creditKnownRequests += 1
      active.add(localDateKey(r.ts))
    }
    if (any) {
      t.sessions += 1
      if (s.isSubAgent) t.subAgentSessions += 1
      else t.mainSessions += 1
    }
  }
  if (!t.requests) return undefined
  return finalizeTotals(t, active.size)
}

/**
 * 合并视图 + 各源切片视图，一次算完。
 * 三个视图共用同一个 aggregate()，避免"端对比"和"总账"用两套口径。
 */
export function aggregatesBySource(
  dataset: Dataset,
  win: WindowSpec,
): { merged: Aggregates; bySource: Partial<Record<SourceId, Aggregates>> } {
  const bySource: Partial<Record<SourceId, Aggregates>> = {}
  for (const source of Object.keys(dataset.bySource) as SourceId[]) {
    bySource[source] = aggregate(dataset, win, { source })
  }
  return { merged: aggregate(dataset, win), bySource }
}
