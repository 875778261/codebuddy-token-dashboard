import type { Dataset } from './types'
import { computeCoverage } from './parse'

/**
 * 快照 = 单一 JSON 文件，是这台机器上的"可携带真值"。
 * 用途：归档（日志会被轮转 / history 会被清理）、换机比对、无目录权限时按文件导入。
 * 不包含任何消息正文，只有会话标题、项目路径与请求级 usage。
 */
export const SNAPSHOT_SCHEMA = 1

export function serializeDataset(dataset: Dataset): string {
  return JSON.stringify(
    {
      schemaVersion: SNAPSHOT_SCHEMA,
      generatedAt: dataset.generatedAt,
      isDemo: dataset.isDemo,
      sources: dataset.sources,
      selfCheck: dataset.selfCheck,
      coverage: dataset.coverage,
      sessions: dataset.sessions.map((s) => ({
        id: s.id,
        projectId: s.projectId,
        type: s.type,
        chatMode: s.chatMode,
        modelId: s.modelId,
        title: s.title,
        cwd: s.cwd,
        status: s.status,
        createdAt: s.createdAt,
        lastMessageAt: s.lastMessageAt,
        requests: s.requests,
      })),
    },
    null,
    0,
  )
}

export function snapshotFileName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `codebuddy-usage-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.json`
}

export function parseSnapshot(text: string): Dataset {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('不是有效的 JSON 文件')
  }
  const doc = raw as Partial<Dataset> & { sessions?: unknown }
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.sessions)) {
    throw new Error('不是 CodeBuddy 用量快照（缺少 sessions 数组）')
  }
  const sessions = (doc.sessions as Dataset['sessions']).map((s) => {
    const requests = (s.requests ?? []).map((r) => ({ ...r }))
    const totals = {
      requests: requests.length,
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
    for (const r of requests) {
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
    return { ...s, requests, totals }
  })
  const dataset: Dataset = {
    schemaVersion: 1,
    isDemo: doc.isDemo ? true : undefined,
    generatedAt: doc.generatedAt ?? new Date().toISOString(),
    sources: doc.sources ?? {
      historyRoots: [],
      projectCount: 0,
      convIndexCount: 0,
      sessionMetaCount: 0,
      scannedAt: doc.generatedAt ?? new Date().toISOString(),
      elapsedMs: 0,
    },
    sessions,
    selfCheck: doc.selfCheck ?? {
      projectIndexFiles: 0,
      convIndexFiles: 0,
      parseErrors: 0,
      requestsTotal: 0,
      requestsWithUsage: 0,
      inFlightSkipped: 0,
      inputEqCachePlusMiss: { ok: 0, fail: 0 },
      totalEqInputPlusOutput: { ok: 0, fail: 0 },
      sessionsWithoutRequests: 0,
      sessionsUnknownModel: 0,
      sessionsWithoutCwd: 0,
      sessionsWithoutTitle: 0,
    },
    coverage: doc.coverage ?? computeCoverage(sessions),
  }
  return dataset
}
