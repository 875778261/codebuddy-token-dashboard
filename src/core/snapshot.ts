import type { Dataset, SelfCheck, SourceId, SourceInfo } from './types'
import { SOURCE_ORDER, SOURCE_META } from './types'
import { computeCoverage, emptySelfCheck, totalsOf } from './parse'
import { normalizeDataset } from './merge'

/**
 * 快照 = 单一 JSON 文件，是这台机器上的"可携带真值"。
 * 用途：归档（日志会被轮转 / history 会被清理）、换机比对、无目录权限时按文件导入。
 * 不包含任何消息正文，只有会话标题、项目路径与请求级 usage。
 *
 * v2：加入 source / bySource / 请求级 model，使「只载入一端」的快照也能单独导入后再与另一端合并。
 * v1：全部视为 CodeBuddy，导入时补前缀与源标记。
 */
export const SNAPSHOT_SCHEMA = 2

export function serializeDataset(dataset: Dataset): string {
  return JSON.stringify(
    {
      schemaVersion: SNAPSHOT_SCHEMA,
      generatedAt: dataset.generatedAt,
      isDemo: dataset.isDemo,
      sources: dataset.sources,
      bySource: dataset.bySource,
      selfCheck: dataset.selfCheck,
      coverage: dataset.coverage,
      sessions: dataset.sessions.map((s) => ({
        id: s.id,
        rawId: s.rawId,
        source: s.source,
        isSubAgent: s.isSubAgent,
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

/** 文件名带源：一眼看出这份快照覆盖了哪几端 */
export function snapshotFileName(now = new Date(), sources?: SourceId[]): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`
  const list = SOURCE_ORDER.filter((s) => (sources ?? ['codebuddy']).includes(s))
  if (list.length <= 1) return `${list[0] ?? 'codebuddy'}-usage-${stamp}.json`
  return `ai-usage-${list.map((s) => SOURCE_META[s].short.toLowerCase()).join('+')}-${stamp}.json`
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
    throw new Error('不是用量快照（缺少 sessions 数组）')
  }
  const sessions = (doc.sessions as Dataset['sessions']).map((s) => {
    const requests = (s.requests ?? []).map((r) => ({ ...r }))
    return { ...s, requests, totals: totalsOf(requests) }
  })
  const info: SourceInfo = doc.sources ?? {
    historyRoots: [],
    projectCount: 0,
    convIndexCount: 0,
    sessionMetaCount: 0,
    scannedAt: doc.generatedAt ?? new Date().toISOString(),
    elapsedMs: 0,
  }
  const selfCheck: SelfCheck = doc.selfCheck ?? emptySelfCheck()
  const dataset: Dataset = {
    schemaVersion: 2,
    isDemo: doc.isDemo ? true : undefined,
    generatedAt: doc.generatedAt ?? new Date().toISOString(),
    sources: info,
    bySource: doc.bySource ?? {},
    sessions,
    selfCheck,
    coverage: doc.coverage ?? computeCoverage(sessions),
  }
  // 统一补齐源标记、id 前缀、项目归一 key 与 bySource（v1 快照走这里）
  return normalizeDataset(dataset, 'codebuddy')
}
