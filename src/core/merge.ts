import type { Coverage, Dataset, SelfCheck, SessionRecord, SourceId, SourceInfo, SourceSummary } from './types'
import { SOURCE_ORDER } from './types'
import { computeCoverage, emptySelfCheck, totalsOf } from './parse'
import { qualify } from './ids'

/**
 * 项目路径归一：只统一分隔符与尾斜杠，**大小写绝不归一**（用户裁定：宁可裂成两行也绝不误并）。
 * 分隔符统一不属于大小写范畴，且不可能造成误并。
 */
export function normalizeProjectPath(raw?: string): string | undefined {
  if (!raw) return undefined
  const s = raw.replace(/\\/g, '/').replace(/\/+$/, '')
  return s || undefined
}

/** 合并层重算：归一后同 key 但原始字符串不同的项目数（只告警，不自动合并） */
export function countSuspectedDuplicateProjects(sessions: SessionRecord[]): number {
  const seen = new Map<string, Set<string>>()
  for (const s of sessions) {
    if (!s.cwd) continue
    const key = normalizeProjectPath(s.cwd)
    if (!key) continue
    const bucket = seen.get(key) ?? new Set<string>()
    bucket.add(s.cwd)
    seen.set(key, bucket)
  }
  let count = 0
  for (const raws of seen.values()) if (raws.size > 1) count += 1
  return count
}

function addSelfCheck(a: SelfCheck, b: SelfCheck): SelfCheck {
  return {
    projectIndexFiles: a.projectIndexFiles + b.projectIndexFiles,
    convIndexFiles: a.convIndexFiles + b.convIndexFiles,
    parseErrors: a.parseErrors + b.parseErrors,
    requestsTotal: a.requestsTotal + b.requestsTotal,
    requestsWithUsage: a.requestsWithUsage + b.requestsWithUsage,
    inFlightSkipped: a.inFlightSkipped + b.inFlightSkipped,
    inputEqCachePlusMiss: { ok: a.inputEqCachePlusMiss.ok + b.inputEqCachePlusMiss.ok, fail: a.inputEqCachePlusMiss.fail + b.inputEqCachePlusMiss.fail },
    totalEqInputPlusOutput: { ok: a.totalEqInputPlusOutput.ok + b.totalEqInputPlusOutput.ok, fail: a.totalEqInputPlusOutput.fail + b.totalEqInputPlusOutput.fail },
    sessionsWithoutRequests: a.sessionsWithoutRequests + b.sessionsWithoutRequests,
    sessionsUnknownModel: a.sessionsUnknownModel + b.sessionsUnknownModel,
    sessionsWithoutCwd: a.sessionsWithoutCwd + b.sessionsWithoutCwd,
    sessionsWithoutTitle: a.sessionsWithoutTitle + b.sessionsWithoutTitle,
    requestsWithoutCredit: a.requestsWithoutCredit + b.requestsWithoutCredit,
    duplicateRequests: a.duplicateRequests + b.duplicateRequests,
    usageZeroFallbacks: a.usageZeroFallbacks + b.usageZeroFallbacks,
    subAgentSessions: a.subAgentSessions + b.subAgentSessions,
    suspectedDuplicateProjects: a.suspectedDuplicateProjects + b.suspectedDuplicateProjects,
  }
}

function fillSelfCheck(sc?: Partial<SelfCheck> | null): SelfCheck {
  const base = emptySelfCheck()
  if (!sc) return base
  return {
    ...base,
    ...sc,
    inputEqCachePlusMiss: sc.inputEqCachePlusMiss ?? base.inputEqCachePlusMiss,
    totalEqInputPlusOutput: sc.totalEqInputPlusOutput ?? base.totalEqInputPlusOutput,
  }
}

function mergeSourceInfo(list: SourceInfo[]): SourceInfo {
  const roots = new Set<string>()
  let projectCount = 0
  let convIndexCount = 0
  let sessionMetaCount = 0
  let elapsedMs = 0
  let scannedAt = ''
  let sessionsDb: string | undefined
  for (const info of list) {
    for (const r of info.historyRoots ?? []) roots.add(r)
    projectCount += info.projectCount ?? 0
    convIndexCount += info.convIndexCount ?? 0
    sessionMetaCount += info.sessionMetaCount ?? 0
    elapsedMs += info.elapsedMs ?? 0
    if (info.scannedAt && info.scannedAt > scannedAt) scannedAt = info.scannedAt
    // 会话库只属于 CodeBuddy；不要拼接两源的名字
    if (info.sessionsDb) sessionsDb = info.sessionsDb
  }
  return {
    historyRoots: [...roots].sort(),
    projectCount,
    convIndexCount,
    sessionMetaCount,
    sessionsDb,
    scannedAt: scannedAt || new Date().toISOString(),
    elapsedMs,
  }
}

/**
 * 把任意来源（含旧缓存 / v1 快照）补齐到 v2 契约：
 * 源标记、带前缀的 id、rawId、项目归一化 key、totals、自检字段。
 */
export function normalizeDataset(input: Dataset, fallbackSource: SourceId = 'codebuddy'): Dataset {
  const sessions: SessionRecord[] = input.sessions.map((raw) => {
    const s = raw as SessionRecord & { source?: SourceId }
    const source = s.source ?? fallbackSource
    const rawId = s.rawId ?? (s.id.startsWith(`${source}:`) ? s.id.slice(source.length + 1) : s.id)
    return {
      ...s,
      source,
      rawId,
      id: qualify(source, rawId),
      projectKey: s.projectKey ?? normalizeProjectPath(s.cwd),
      totals: s.totals?.requests ? s.totals : totalsOf(s.requests ?? []),
    }
  })
  sessions.sort((a, b) => a.totals.firstTs - b.totals.firstTs)

  const coverage = computeCoverage(sessions)
  const selfCheck = fillSelfCheck(input.selfCheck)

  // 老数据没有 bySource：按实际出现的源合成一份，保证 end-to-end 只有一种读取路径
  let bySource = input.bySource
  const present = new Set(sessions.map((s) => s.source))
  const hasSummaries = bySource && Object.keys(bySource).length > 0
  if (!hasSummaries) {
    bySource = {}
    for (const source of present) {
      const subset = sessions.filter((s) => s.source === source)
      bySource[source] = {
        info: { ...input.sources, scannedAt: input.sources.scannedAt || input.generatedAt },
        selfCheck,
        coverage: computeCoverage(subset),
      }
    }
  }

  return {
    ...input,
    schemaVersion: 2,
    sessions,
    selfCheck,
    coverage,
    bySource,
  }
}

/** 合并后的自检：计数相加，只有「疑似同项目」在合并层重算 */
function mergedSelfCheck(bySource: Partial<Record<SourceId, SourceSummary>>, sessions: SessionRecord[]): SelfCheck {
  let acc = emptySelfCheck()
  for (const source of SOURCE_ORDER) {
    const summary = bySource[source]
    if (summary) acc = addSelfCheck(acc, fillSelfCheck(summary.selfCheck))
  }
  acc.suspectedDuplicateProjects = countSuspectedDuplicateProjects(sessions)
  return acc
}

/**
 * 把 N 个单源切片合并成一份 Dataset。纯函数，不做任何跨源去重
 * （实测两源 token 零重叠；跨源"去重"只会掩盖单源解析 bug）。
 *
 * 同一源只应出现一次：重复时以最后一个为准（调用方负责提示"替换"语义）。
 */
export function mergeSlices(slices: Dataset[]): Dataset {
  const bySourceSlice = new Map<SourceId, Dataset>()
  for (const slice of slices) {
    if (!slice?.sessions) continue
    const normalized = normalizeDataset(slice)
    // 单切片内部可能混有两个源（导入的合并快照），按源拆开
    for (const source of new Set(normalized.sessions.map((s) => s.source))) {
      const subset = normalized.sessions.filter((s) => s.source === source)
      const summary = normalized.bySource[source]
      const one: Dataset = {
        ...normalized,
        sessions: subset,
        sources: summary?.info ?? normalized.sources,
        bySource: summary ? { [source]: summary } : {},
        coverage: computeCoverage(subset),
      }
      bySourceSlice.set(source, one) // 替换语义：同源后到者覆盖
    }
  }

  const ordered = SOURCE_ORDER.map((s) => bySourceSlice.get(s)).filter((d): d is Dataset => Boolean(d))
  if (!ordered.length) {
    const selfCheck = emptySelfCheck()
    const info: SourceInfo = { historyRoots: [], projectCount: 0, convIndexCount: 0, sessionMetaCount: 0, scannedAt: new Date().toISOString(), elapsedMs: 0 }
    return { schemaVersion: 2, generatedAt: new Date().toISOString(), sources: info, bySource: {}, sessions: [], selfCheck, coverage: { daysWithData: 0, daysInRange: 0, missingDays: [] } }
  }

  const sessions = ordered.flatMap((d) => d.sessions).sort((a, b) => a.totals.firstTs - b.totals.firstTs)
  const bySource: Partial<Record<SourceId, SourceSummary>> = {}
  for (const slice of ordered) {
    for (const [source, summary] of Object.entries(slice.bySource) as Array<[SourceId, SourceSummary]>) {
      bySource[source] = summary
    }
  }
  // 切片缺 bySource 时兜底合成（只信自己的 sessions，不借用别的源的总量）
  for (const slice of ordered) {
    const source = slice.sessions[0]?.source
    if (!source || bySource[source]) continue
    const subset = sessions.filter((s) => s.source === source)
    bySource[source] = {
      info: slice.sources,
      selfCheck: slice.selfCheck,
      coverage: computeCoverage(subset),
    }
  }

  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    sources: mergeSourceInfo(ordered.map((d) => d.sources)),
    bySource,
    sessions,
    selfCheck: mergedSelfCheck(bySource, sessions),
    coverage: computeCoverage(sessions),
    isDemo: ordered.some((d) => d.isDemo) ? true : undefined,
  }
}

/** 导入的合并快照 → 按源拆成切片，交给 App 的「每源一份」状态 */
export function splitBySource(dataset: Dataset): Partial<Record<SourceId, Dataset>> {
  const normalized = normalizeDataset(dataset)
  const out: Partial<Record<SourceId, Dataset>> = {}
  for (const source of new Set(normalized.sessions.map((s) => s.source))) {
    const subset = normalized.sessions.filter((s) => s.source === source)
    const summary = normalized.bySource[source]
    out[source] = {
      ...normalized,
      sessions: subset,
      sources: summary?.info ?? normalized.sources,
      bySource: summary ? { [source]: summary } : {},
      selfCheck: summary?.selfCheck ?? normalized.selfCheck,
      coverage: computeCoverage(subset),
    }
  }
  return out
}

/** 取某个源的切片视图（没有该源返回 null）；用于「只载入一端」的判定 */
export function sliceOf(dataset: Dataset, source: SourceId): Dataset | null {
  const sessions = dataset.sessions.filter((s) => s.source === source)
  if (!sessions.length) return null
  const summary = dataset.bySource[source]
  return {
    ...dataset,
    sessions,
    bySource: summary ? { [source]: summary } : {},
    coverage: computeCoverage(sessions),
  }
}

export function hasSource(dataset: Dataset | null | undefined, source: SourceId): boolean {
  return Boolean(dataset?.bySource?.[source]) || Boolean(dataset?.sessions.some((s) => s.source === source))
}

export function coverageOf(dataset: Dataset, source: SourceId): Coverage {
  return dataset.bySource[source]?.coverage ?? computeCoverage(dataset.sessions.filter((s) => s.source === source))
}
