import type {
  ConvIndexDoc,
  CountPair,
  Coverage,
  Dataset,
  ProjectIndexDoc,
  RequestRecord,
  SelfCheck,
  SessionMeta,
  SessionRecord,
  SessionTotals,
  SourceInfo,
} from './types'
import { dayList, localDateKey } from './format'

export interface ScannedFile {
  /** 相对扫描根的路径分段，例如 ['fdb…','CodeBuddyIDE','fdb…','history','0be5…','7f00…','index.json'] */
  path: string[]
  text: string
}

export interface ParseInput {
  files: ScannedFile[]
  sessionMeta?: SessionMeta[]
  sources: Omit<SourceInfo, 'projectCount' | 'convIndexCount' | 'sessionMetaCount' | 'elapsedMs'>
  elapsedMs: number
}

const isoToMs = (v?: string): number | undefined => {
  if (!v) return undefined
  const ms = Date.parse(v)
  return Number.isFinite(ms) ? ms : undefined
}

function pathParts(path: string[]) {
  const dirs = path.slice(0, -1)
  const historyIdx = dirs.lastIndexOf('history')
  if (historyIdx >= 0) {
    const projectId = dirs[historyIdx + 1] ?? 'unknown'
    const convId = dirs[historyIdx + 2] ?? dirs[dirs.length - 1] ?? 'unknown'
    return { projectId, conversationId: convId, historyIdx }
  }
  const convId = dirs[dirs.length - 1] ?? 'unknown'
  const projectId = dirs[dirs.length - 2] ?? 'unknown'
  return { projectId, conversationId: convId, historyIdx: -1 }
}

function emptyTotals(): SessionTotals {
  return {
    requests: 0,
    total: 0,
    input: 0,
    output: 0,
    cache: 0,
    cacheMiss: 0,
    cacheWrite: 0,
    credit: 0,
    firstTs: Number.POSITIVE_INFINITY,
    lastTs: 0,
  }
}

function bump(totals: SessionTotals, r: RequestRecord) {
  totals.requests += 1
  totals.total += r.total
  totals.input += r.input
  totals.output += r.output
  totals.cache += r.cache
  totals.cacheMiss += r.cacheMiss
  totals.cacheWrite += r.cacheWrite
  totals.credit += r.credit
  if (r.ts < totals.firstTs) totals.firstTs = r.ts
  if (r.ts > totals.lastTs) totals.lastTs = r.ts
}

export function buildDataset(input: ParseInput): Dataset {
  const pair = (): CountPair => ({ ok: 0, fail: 0 })
  const selfCheck: SelfCheck = {
    projectIndexFiles: 0,
    convIndexFiles: 0,
    parseErrors: 0,
    requestsTotal: 0,
    requestsWithUsage: 0,
    inFlightSkipped: 0,
    inputEqCachePlusMiss: pair(),
    totalEqInputPlusOutput: pair(),
    sessionsWithoutRequests: 0,
    sessionsUnknownModel: 0,
    sessionsWithoutCwd: 0,
    sessionsWithoutTitle: 0,
  }

  const projectMeta = new Map<string, NonNullable<ProjectIndexDoc['conversations']>[number]>()
  const convDocs: Array<{ projectId: string; conversationId: string; doc: ConvIndexDoc }> = []
  const historyRoots = new Set<string>(input.sources.historyRoots)

  for (const file of input.files) {
    if (!file.path[file.path.length - 1]?.endsWith('.json')) continue
    let doc: unknown
    try {
      doc = JSON.parse(file.text)
    } catch {
      selfCheck.parseErrors += 1
      continue
    }
    if (!doc || typeof doc !== 'object') continue
    const asProject = doc as ProjectIndexDoc
    if (Array.isArray(asProject.conversations)) {
      selfCheck.projectIndexFiles += 1
      const parts = pathParts(file.path)
      if (parts.historyIdx >= 0) {
        historyRoots.add(file.path.slice(0, parts.historyIdx + 1).join('/'))
      }
      for (const conv of asProject.conversations) {
        if (conv?.id) projectMeta.set(conv.id, conv)
      }
      continue
    }
    const asConv = doc as ConvIndexDoc
    if (Array.isArray(asConv.requests)) {
      selfCheck.convIndexFiles += 1
      const parts = pathParts(file.path)
      convDocs.push({ projectId: parts.projectId, conversationId: parts.conversationId, doc: asConv })
      if (parts.historyIdx >= 0) {
        historyRoots.add(file.path.slice(0, parts.historyIdx + 1).join('/'))
      }
      continue
    }
  }

  const metaById = new Map<string, SessionMeta>()
  for (const meta of input.sessionMeta ?? []) {
    if (meta?.conversationId) metaById.set(meta.conversationId, meta)
  }

  const sessions: SessionRecord[] = []
  const seen = new Set<string>()

  for (const { projectId, conversationId, doc } of convDocs) {
    const requests: RequestRecord[] = []
    for (const raw of doc.requests ?? []) {
      selfCheck.requestsTotal += 1
      const usage = raw?.usage
      if (!usage || !raw.startedAt) {
        // 在途请求（无 usage）与脏数据都不进统计；两者都无法归集时间
        selfCheck.inFlightSkipped += 1
        continue
      }
      selfCheck.requestsWithUsage += 1
      const input = usage.inputTokens ?? 0
      const output = usage.outputTokens ?? 0
      const total = usage.totalTokens ?? input + output
      const cache = usage.cacheTokens ?? 0
      const cacheWrite = usage.cachedWriteTokens ?? 0
      const cacheMiss = usage.cachedMissTokens ?? 0

      // 实测 674/674：input == cache + miss（本机 cacheWrite 恒为 0）。
      // 兼容未来出现 cacheWrite 的形态：两种口径任一成立即视为一致。
      if (input === cache + cacheMiss + cacheWrite || input === cache + cacheMiss) {
        selfCheck.inputEqCachePlusMiss.ok += 1
      } else {
        selfCheck.inputEqCachePlusMiss.fail += 1
      }
      if (total === input + output) selfCheck.totalEqInputPlusOutput.ok += 1
      else selfCheck.totalEqInputPlusOutput.fail += 1

      requests.push({
        ts: raw.startedAt,
        type: raw.type ?? 'unknown',
        input,
        output,
        total,
        cache,
        cacheWrite,
        cacheMiss,
        credit: usage.credit ?? 0,
        lastTokens: usage.lastTokens ?? 0,
      })
    }

    if (!requests.length) {
      selfCheck.sessionsWithoutRequests += 1
      continue
    }
    requests.sort((a, b) => a.ts - b.ts)

    const convMeta = projectMeta.get(conversationId)
    const dbMeta = metaById.get(conversationId)
    const totals = emptyTotals()
    for (const r of requests) bump(totals, r)

    const session: SessionRecord = {
      id: conversationId,
      projectId,
      type: convMeta?.type ?? requests[0].type,
      chatMode: convMeta?.chatMode,
      modelId: convMeta?.selectedModelId,
      title: dbMeta?.title || convMeta?.name || undefined,
      cwd: dbMeta?.cwd,
      status: dbMeta?.status,
      createdAt: dbMeta?.createdAt ?? isoToMs(convMeta?.createdAt),
      lastMessageAt: dbMeta?.updatedAt ?? isoToMs(convMeta?.lastMessageAt),
      requests,
      totals,
    }
    if (!session.modelId) selfCheck.sessionsUnknownModel += 1
    if (!session.cwd) selfCheck.sessionsWithoutCwd += 1
    if (!session.title) selfCheck.sessionsWithoutTitle += 1

    // 同一 conversationId 可能出现在多个历史根（换机/换账号），合并而不是覆盖
    if (seen.has(conversationId)) {
      const prev = sessions.find((s) => s.id === conversationId)!
      prev.requests = [...prev.requests, ...requests].sort((a, b) => a.ts - b.ts)
      const merged = emptyTotals()
      for (const r of prev.requests) bump(merged, r)
      prev.totals = merged
      prev.cwd = prev.cwd ?? session.cwd
      prev.title = prev.title ?? session.title
      prev.modelId = prev.modelId ?? session.modelId
      continue
    }
    seen.add(conversationId)
    sessions.push(session)
  }

  sessions.sort((a, b) => a.totals.firstTs - b.totals.firstTs)

  const coverage = computeCoverage(sessions)

  const sourceInfo: SourceInfo = {
    ...input.sources,
    historyRoots: [...historyRoots].sort(),
    projectCount: selfCheck.projectIndexFiles,
    convIndexCount: selfCheck.convIndexFiles,
    sessionMetaCount: metaById.size,
    elapsedMs: input.elapsedMs,
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sources: sourceInfo,
    sessions,
    selfCheck,
    coverage,
  }
}

/**
 * 把会话库元数据补进已有数据集（用户先选/拖了 Data，再补 codebuddy-sessions.vscdb）。
 * 只补 title / cwd / status 等元数据，不重算任何 token。
 */
export function applySessionMeta(dataset: Dataset, sessionMeta: SessionMeta[], dbName?: string): Dataset {
  const byId = new Map<string, SessionMeta>()
  for (const m of sessionMeta) if (m?.conversationId) byId.set(m.conversationId, m)
  if (!byId.size) return dataset

  const sessions = dataset.sessions.map((s) => {
    const m = byId.get(s.id)
    if (!m) return s
    return {
      ...s,
      title: m.title || s.title,
      cwd: m.cwd || s.cwd,
      status: m.status || s.status,
      createdAt: s.createdAt ?? m.createdAt,
      lastMessageAt: s.lastMessageAt ?? m.updatedAt,
    }
  })

  return {
    ...dataset,
    generatedAt: new Date().toISOString(),
    sessions,
    selfCheck: {
      ...dataset.selfCheck,
      sessionsWithoutCwd: sessions.filter((s) => !s.cwd).length,
      sessionsWithoutTitle: sessions.filter((s) => !s.title).length,
      sessionsUnknownModel: sessions.filter((s) => !s.modelId).length,
    },
    sources: {
      ...dataset.sources,
      sessionsDb: dbName ?? dataset.sources.sessionsDb,
      sessionMetaCount: byId.size,
    },
  }
}

export function computeCoverage(sessions: SessionRecord[]): Coverage {
  const days = new Set<string>()
  let first = Number.POSITIVE_INFINITY
  let last = 0
  for (const s of sessions) {
    for (const r of s.requests) {
      days.add(localDateKey(r.ts))
      if (r.ts < first) first = r.ts
      if (r.ts > last) last = r.ts
    }
  }
  if (!days.size) return { daysWithData: 0, daysInRange: 0, missingDays: [] }
  const all = dayList(first, last)
  return {
    first: localDateKey(first),
    last: localDateKey(last),
    daysWithData: days.size,
    daysInRange: all.length,
    missingDays: all.filter((d) => !days.has(d)),
  }
}
