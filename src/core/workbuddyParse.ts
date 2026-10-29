import type { Coverage, Dataset, RequestRecord, SessionRecord, SourceInfo } from './types'
import type { LazyFile } from './parse'
import { computeCoverage, emptySelfCheck, totalsOf } from './parse'
import { qualify } from './ids'

/**
 * WorkBuddy 本地 jsonl → Dataset。
 *
 * 实测口径（docs/workbuddy-data-sources.md §2 / §9）：
 * - 一条带 providerData.usage 的记录 = 一次请求；usage.requests 恒为 1，不能按 turn 计数
 * - usage 整组全零时**整组**回落 rawUsage（1 例 custom-local，漏了会少 67,916 token）
 * - 缓存三段：hit = inputTokensDetails[0].cached_tokens（回退 rawUsage.prompt_cache_hit_tokens），miss = input - hit
 * - 去重键 (sessionId, messageId)：保留 timestamp 最大者（14 组重试双写）
 * - 必须递归到 <sessionId>/subagents/*.jsonl（82 个文件，4.8% 用量，与主文件零交集）
 * - 首版不读 workbuddy.db：标题来自 ai-title 记录（63%），缺失留空
 */

/** 跨源已对齐的模型别名（沿用参照实现的口径） */
const MODEL_ALIAS: Record<string, string> = { 'glm-5.2-x': 'glm-5.2' }

export function normalizeWorkbuddyModel(raw?: string | null): string | undefined {
  if (!raw || typeof raw !== 'string') return undefined
  const name = raw.trim()
  if (!name) return undefined
  return MODEL_ALIAS[name] ?? name
}

interface WbUsage {
  requests?: number | null
  inputTokens?: number | null
  outputTokens?: number | null
  totalTokens?: number | null
  inputTokensDetails?: Array<{ cached_tokens?: number | null } | null> | null
  outputTokensDetails?: Array<{ reasoning_tokens?: number | null } | null> | null
}

interface WbRawUsage {
  prompt_tokens?: number | null
  completion_tokens?: number | null
  total_tokens?: number | null
  prompt_cache_hit_tokens?: number | null
  prompt_cache_miss_tokens?: number | null
  prompt_tokens_details?: { cached_tokens?: number | null } | null
  completion_thinking_tokens?: number | null
  credit?: number | null
}

interface WbProviderData {
  messageId?: string
  conversationRequestId?: string
  model?: string
  requestModelName?: string
  requestModelId?: string
  isSubAgent?: boolean
  usage?: WbUsage | null
  rawUsage?: WbRawUsage | null
}

interface WbRecord {
  type?: string
  sessionId?: string
  timestamp?: number | string
  cwd?: string
  title?: string
  aiTitle?: string
  data?: { title?: string }
  meta?: Record<string, unknown>
  providerData?: WbProviderData | null
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

function tsOf(v: number | string | undefined): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const ms = Date.parse(v)
    if (Number.isFinite(ms)) return ms
  }
  return undefined
}

/** 路径里的项目目录名：projects/<项目目录>/<sessionId>.jsonl 或 .../<sessionId>/subagents/*.jsonl */
function projectDirOf(path: string[]): string {
  const idx = path.lastIndexOf('projects')
  if (idx >= 0 && path[idx + 1]) return path[idx + 1]
  return path[path.length - 2] ?? 'unknown'
}

function projectRootOf(path: string[]): string | undefined {
  const idx = path.lastIndexOf('projects')
  return idx >= 0 ? path.slice(0, idx + 1).join('/') || 'projects' : undefined
}

interface WbRequest extends RequestRecord {
  sessionId: string
  projectDir: string
  cwd?: string
  isSubAgent: boolean
}

export interface WorkbuddyParseOptions {
  /** 采集源信息（historyRoots 会被实际命中的 projects 根覆盖） */
  sources: Omit<SourceInfo, 'projectCount' | 'convIndexCount' | 'sessionMetaCount' | 'elapsedMs'>
  elapsedMs?: number
  onProgress?: (done: number, total: number) => void
}

/**
 * @param files 惰性文件：一次只读一个，解析完立即丢弃原文（213MB 文本不能常驻）
 */
export async function parseWorkbuddy(files: LazyFile[], opts: WorkbuddyParseOptions): Promise<Dataset> {
  const selfCheck = emptySelfCheck()
  const byKey = new Map<string, WbRequest>()
  const titles = new Map<string, string>()
  const projectDirs = new Set<string>()
  const projectRoots = new Set<string>(opts.sources.historyRoots)
  let fileCount = 0
  let recordSeq = 0

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    let text = ''
    try {
      text = await file.read()
    } catch {
      selfCheck.parseErrors += 1
      continue
    }
    fileCount += 1
    const dir = projectDirOf(file.path)
    projectDirs.add(dir)
    const root = projectRootOf(file.path)
    if (root) projectRoots.add(root)
    const isSubFile = file.path.includes('subagents')

    // 逐行解析：不要 split('\n') 生成整份副本，210MB 文件会翻倍
    let start = 0
    while (start <= text.length) {
      let end = text.indexOf('\n', start)
      if (end === -1) end = text.length
      const line = text.slice(start, end).trim()
      start = end + 1
      if (!line) continue

      let rec: WbRecord
      try {
        rec = JSON.parse(line) as WbRecord
      } catch {
        selfCheck.parseErrors += 1
        continue
      }
      if (!rec || typeof rec !== 'object') continue

      const sid = typeof rec.sessionId === 'string' ? rec.sessionId : undefined

      // 标题只作增强，拿不到就留空
      if (sid && (rec.type === 'ai-title' || rec.type === 'session-meta')) {
        const metaTitle = rec.meta?.['codebuddy.ai/sessionTitle']
        const t = rec.title ?? rec.aiTitle ?? rec.data?.title ?? (typeof metaTitle === 'string' ? metaTitle : undefined)
        if (typeof t === 'string' && t.trim()) titles.set(sid, t.trim())
        continue
      }

      const pd = rec.providerData
      if (!pd || typeof pd !== 'object') continue
      const u = pd.usage
      if (!u || typeof u !== 'object') continue

      selfCheck.requestsTotal += 1
      recordSeq += 1

      const ru: WbRawUsage = pd.rawUsage && typeof pd.rawUsage === 'object' ? pd.rawUsage : {}
      let total: number
      let input: number
      let output: number
      let hit: number
      let rawMiss: number | undefined

      if (num(u.totalTokens)) {
        total = num(u.totalTokens)!
        input = num(u.inputTokens) ?? 0
        output = num(u.outputTokens) ?? 0
        const details = Array.isArray(u.inputTokensDetails) ? u.inputTokensDetails : []
        const cached = num(details[0]?.cached_tokens)
        hit = cached ?? num(ru.prompt_cache_hit_tokens) ?? num(ru.prompt_tokens_details?.cached_tokens) ?? 0
        rawMiss = num(ru.prompt_cache_miss_tokens)
      } else {
        // usage 整组全零 / 缺 totalTokens：整组回落 rawUsage，保证三字段同源
        total = num(ru.total_tokens) ?? 0
        input = num(ru.prompt_tokens) ?? 0
        output = num(ru.completion_tokens) ?? 0
        hit = num(ru.prompt_cache_hit_tokens) ?? num(ru.prompt_tokens_details?.cached_tokens) ?? 0
        rawMiss = num(ru.prompt_cache_miss_tokens)
        if (total > 0) selfCheck.usageZeroFallbacks += 1
      }

      if (hit > input) hit = input
      const cacheMiss = Math.max(0, input - hit)

      // 两条恒等式：total == in + out；hit + miss == input（有原始 miss 字段时逐条核对）
      if (total === input + output) selfCheck.totalEqInputPlusOutput.ok += 1
      else selfCheck.totalEqInputPlusOutput.fail += 1
      if (rawMiss === undefined || hit + rawMiss === input) selfCheck.inputEqCachePlusMiss.ok += 1
      else selfCheck.inputEqCachePlusMiss.fail += 1

      const ts = tsOf(rec.timestamp)
      if (!ts) {
        selfCheck.inFlightSkipped += 1
        continue
      }

      const credit = num(ru.credit)
      if (credit === undefined) selfCheck.requestsWithoutCredit += 1

      const model = normalizeWorkbuddyModel(pd.model) ?? normalizeWorkbuddyModel(pd.requestModelName) ?? normalizeWorkbuddyModel(pd.requestModelId)
      const mid = pd.messageId ?? pd.conversationRequestId ?? `line-${i}-${recordSeq}`
      const key = `${sid ?? 'unknown'}:${mid}`

      const req: WbRequest = {
        key,
        ts,
        type: 'workbuddy',
        input,
        output,
        total,
        cache: hit,
        cacheWrite: 0,
        cacheMiss,
        credit: credit ?? 0,
        creditKnown: credit !== undefined,
        lastTokens: output,
        model,
        sessionId: sid ?? 'unknown',
        projectDir: dir,
        cwd: typeof rec.cwd === 'string' ? rec.cwd : undefined,
        isSubAgent: isSubFile || pd.isSubAgent === true,
      }

      const prev = byKey.get(key)
      if (prev) {
        selfCheck.duplicateRequests += 1
        if (req.ts > prev.ts) byKey.set(key, req)
      } else {
        byKey.set(key, req)
      }
    }
  }

  // 按会话归集
  const groups = new Map<string, WbRequest[]>()
  for (const req of byKey.values()) {
    const list = groups.get(req.sessionId) ?? []
    list.push(req)
    groups.set(req.sessionId, list)
  }

  const sessions: SessionRecord[] = []
  for (const [sid, list] of groups) {
    list.sort((a, b) => a.ts - b.ts)
    const projectDir = list[0].projectDir
    const cwd = modeOf(list.map((r) => r.cwd).filter((v): v is string => Boolean(v)))
    const modelCount = new Map<string, number>()
    for (const r of list) if (r.model) modelCount.set(r.model, (modelCount.get(r.model) ?? 0) + r.total)
    const dominantModel = [...modelCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    const isSubAgent = list.some((r) => r.isSubAgent)
    // 只保留请求级字段：会话归属字段留在 WbRequest 上，不进快照
    const requests: RequestRecord[] = list.map((r) => ({
      key: r.key,
      ts: r.ts,
      type: r.type,
      input: r.input,
      output: r.output,
      total: r.total,
      cache: r.cache,
      cacheWrite: r.cacheWrite,
      cacheMiss: r.cacheMiss,
      credit: r.credit,
      creditKnown: r.creditKnown,
      lastTokens: r.lastTokens,
      model: r.model,
    }))
    const title = titles.get(sid)

    const session: SessionRecord = {
      id: qualify('workbuddy', sid),
      rawId: sid,
      source: 'workbuddy',
      isSubAgent,
      projectId: projectDir,
      type: 'workbuddy',
      chatMode: isSubAgent ? 'subagent' : 'craft',
      modelId: dominantModel,
      title,
      cwd,
      createdAt: list[0].ts,
      lastMessageAt: list[list.length - 1].ts,
      requests,
      totals: totalsOf(requests),
    }
    if (!session.modelId && !isSubAgent) selfCheck.sessionsUnknownModel += 1
    if (!cwd) selfCheck.sessionsWithoutCwd += 1
    if (!title) selfCheck.sessionsWithoutTitle += 1
    if (isSubAgent) selfCheck.subAgentSessions += 1
    sessions.push(session)
  }

  sessions.sort((a, b) => a.totals.firstTs - b.totals.firstTs)

  selfCheck.requestsWithUsage = byKey.size
  selfCheck.projectIndexFiles = projectDirs.size
  selfCheck.convIndexFiles = fileCount

  const coverage: Coverage = computeCoverage(sessions)
  const info: SourceInfo = {
    ...opts.sources,
    historyRoots: [...projectRoots].sort(),
    projectCount: projectDirs.size,
    convIndexCount: fileCount,
    sessionMetaCount: titles.size,
    scannedAt: opts.sources.scannedAt || new Date().toISOString(),
    elapsedMs: opts.elapsedMs ?? 0,
  }

  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    sources: info,
    bySource: { workbuddy: { info, selfCheck, coverage } },
    sessions,
    selfCheck,
    coverage,
  }
}

function modeOf(values: string[]): string | undefined {
  if (!values.length) return undefined
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
}
