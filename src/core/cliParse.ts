import type { Coverage, Dataset, RequestRecord, SelfCheck, SessionRecord, SourceInfo } from './types'
import type { LazyFile } from './parse'
import { computeCoverage, emptySelfCheck, totalsOf } from './parse'
import { qualify } from './ids'

/**
 * CodeBuddy CLI（`~/.codebuddy`）→ Dataset。
 *
 * 实测口径（docs/codebuddy-cli-data-sources.md）：
 * - 主源是 `logs/<YYYY-MM-DD>/<cwd名>__<hash>.log`：一条
 *   `[ModelProvider] {... "event_name":"agent.model_call.completed"}` = 一次请求（= 一次真实 API 调用）
 * - 一次用户 turn 内含多条请求：`conversation_request_id` 只是分组键，不是请求
 * - 积分来自 `[SessionManager][credit] Credit received: rootRequestId=<conversation_request_id>,
 *   source=raw_model_stream_event|response_done, credit=<n>`：一次调用一条，但同一份值写两遍
 *   （两个 source），且同一 turn 内多条调用的积分**只保证顺序**、不保证可区分；
 *   因此按 rootRequestId 分组、组内各自按时间排序后「第 i 条 credit 配第 i 次调用」
 * - `projects/<编码cwd>/<sessionId>.jsonl` 在本机是空壳（0 条 usage），只用于未来兼容；
 *   项目归属取自每个 .log 的首行 `Workspace Path:`
 * - 辅助 agent（会话标题生成等）在 traces 里是 `agent.kind=auxiliary`，日志里是独立 conversation_id，
 *   计入总量但打 isSubAgent 标（与 WorkBuddy 的 subagents 口径一致）
 * - 日志会按天轮转，是唯一「过了就没了」的源：调用方需要把结果累积进归档
 */

const TS_RE = /^\[(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3})\]/
const WORKSPACE_RE = /^Workspace Path:\s*(.+)$/
const CREDIT_RE = /Credit received:\s*rootRequestId=([^,\s]+),\s*source=([a-z_]+),\s*credit=([0-9.]+)/
const CREDIT_SOURCE = 'raw_model_stream_event'

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** `[2026/11/20 12:01:05.475]` → 本机时区毫秒 */
function tsOf(line: string): number | undefined {
  const m = TS_RE.exec(line)
  if (!m) return undefined
  const ms = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6]),
    Number(m[7]),
  ).getTime()
  return Number.isFinite(ms) ? ms : undefined
}

interface ModelCallLine {
  model?: string
  step?: number
  attempt?: number
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
  cached_read_tokens?: number
  cached_write_tokens?: number
  finish_reason?: string
  event_id?: string
  conversation_id?: string
  conversation_request_id?: string
  conversation_message_id?: string
}

interface CliCall {
  key: string
  ts: number
  sid: string
  reqId: string
  model?: string
  input: number
  output: number
  total: number
  cache: number
  cacheWrite: number
  cwd?: string
  credit?: number
}

interface CreditLine {
  reqId: string
  credit: number
  ts?: number
  source: string
  seq: number
}

interface TraceAgent {
  kind?: string
  name?: string
  sessionId?: string
  parentSessionId?: string
}

export interface CliParseOptions {
  sources: Omit<SourceInfo, 'projectCount' | 'convIndexCount' | 'sessionMetaCount' | 'elapsedMs'>
  elapsedMs?: number
  /** 本轮扫描前已归档的 CLI 切片：日志轮转后仍要保住历史 */
  archived?: Dataset | null
  onProgress?: (done: number, total: number) => void
}

/** 日志文件形状：`logs/<YYYY-MM-DD>/*.log` */
export function isCliLogPath(path: string[]): boolean {
  const file = path[path.length - 1]
  if (!file?.endsWith('.log')) return false
  return path.slice(0, -1).includes('logs')
}

/** traces 形状：`traces/<pid>/trace_*.jsonl`，只用来判定辅助 agent，不含用量 */
export function isCliTracePath(path: string[]): boolean {
  const file = path[path.length - 1]
  if (!file?.startsWith('trace_') || !file.endsWith('.jsonl')) return false
  return path.slice(0, -1).includes('traces')
}

export async function parseCli(
  logFiles: LazyFile[],
  traceFiles: LazyFile[],
  opts: CliParseOptions,
): Promise<Dataset> {
  const selfCheck = emptySelfCheck()
  const calls = new Map<string, CliCall>()
  const credits: CreditLine[] = []
  let creditSeq = 0
  let logFilesHit = 0

  for (let i = 0; i < logFiles.length; i++) {
    const file = logFiles[i]
    if (!isCliLogPath(file.path)) continue
    let text = ''
    try {
      text = await file.read()
    } catch {
      selfCheck.parseErrors += 1
      continue
    }

    // 先认首行 cwd：整份日志的请求都归这个工作目录
    let cwd: string | undefined
    let start = 0
    let sawCall = false
    while (start <= text.length) {
      let end = text.indexOf('\n', start)
      if (end === -1) end = text.length
      const line = text.slice(start, end)
      start = end + 1
      if (!line) continue

      if (!cwd) {
        const ws = WORKSPACE_RE.exec(line.trim())
        if (ws) cwd = ws[1].trim()
      }

      if (line.includes('Credit received')) {
        const m = CREDIT_RE.exec(line)
        if (m) {
          credits.push({ reqId: m[1], credit: Number(m[3]), ts: tsOf(line), source: m[2], seq: creditSeq++ })
        }
        continue
      }

      if (!line.includes('agent.model_call.completed')) continue
      const brace = line.indexOf('{"')
      if (brace < 0) continue
      let rec: ModelCallLine
      try {
        rec = JSON.parse(line.slice(brace)) as ModelCallLine
      } catch {
        selfCheck.parseErrors += 1
        continue
      }
      const ts = tsOf(line)
      const sid = rec.conversation_id
      if (!ts || !sid) {
        selfCheck.inFlightSkipped += 1
        continue
      }

      selfCheck.requestsTotal += 1
      sawCall = true

      const input = num(rec.input_tokens) ?? 0
      const output = num(rec.output_tokens) ?? 0
      const total = num(rec.total_tokens) ?? input + output
      let cache = num(rec.cached_read_tokens) ?? 0
      if (cache > input) cache = input
      const cacheWrite = num(rec.cached_write_tokens) ?? 0

      // 两条恒等式逐条核对：total == in + out；cache + miss == input
      if (total === input + output) selfCheck.totalEqInputPlusOutput.ok += 1
      else selfCheck.totalEqInputPlusOutput.fail += 1
      selfCheck.inputEqCachePlusMiss.ok += 1

      const key = rec.event_id ?? rec.conversation_message_id ?? `${sid}:${ts}:${selfCheck.requestsTotal}`
      const call: CliCall = {
        key,
        ts,
        sid,
        reqId: rec.conversation_request_id ?? sid,
        model: rec.model,
        input,
        output,
        total,
        cache,
        cacheWrite,
        cwd,
      }
      const prev = calls.get(key)
      if (prev) {
        selfCheck.duplicateRequests += 1
        if (call.ts >= prev.ts) calls.set(key, call)
      } else {
        calls.set(key, call)
      }
    }

    if (sawCall) logFilesHit += 1
    if (opts.onProgress && i % 5 === 0) opts.onProgress(i + 1, logFiles.length)
  }

  // 积分配对：同一 rootRequestId 内，第 i 条 credit 配第 i 次调用
  pairCredits(calls, credits, selfCheck)

  // 辅助 agent：traces 里 agent.kind=auxiliary 的会话打标（日志本身没有这个字段）
  const agents = await readTraceAgents(traceFiles)

  const groups = new Map<string, CliCall[]>()
  for (const call of calls.values()) {
    const list = groups.get(call.sid) ?? []
    list.push(call)
    groups.set(call.sid, list)
  }

  const sessions: SessionRecord[] = []
  const projects = new Set<string>()
  for (const [sid, list] of groups) {
    list.sort((a, b) => a.ts - b.ts)
    const cwd = modeOf(list.map((r) => r.cwd).filter((v): v is string => Boolean(v)))
    const projectId = cwd ? lastSegment(cwd) : 'unknown'
    if (projectId !== 'unknown') projects.add(projectId)
    const agent = agents.get(sid)
    const isSubAgent = agent?.kind === 'auxiliary' || Boolean(agent?.parentSessionId && agent.parentSessionId !== sid)
    const modelCount = new Map<string, number>()
    for (const r of list) if (r.model) modelCount.set(r.model, (modelCount.get(r.model) ?? 0) + r.total)
    const dominantModel = [...modelCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]

    const requests: RequestRecord[] = list.map((r) => ({
      key: r.key,
      ts: r.ts,
      type: 'cli',
      input: r.input,
      output: r.output,
      total: r.total,
      cache: r.cache,
      cacheWrite: r.cacheWrite,
      cacheMiss: Math.max(0, r.input - r.cache),
      credit: r.credit ?? 0,
      creditKnown: r.credit !== undefined,
      lastTokens: r.output,
      model: r.model,
    }))

    if (!dominantModel) selfCheck.sessionsUnknownModel += 1
    if (!cwd) selfCheck.sessionsWithoutCwd += 1
    selfCheck.sessionsWithoutTitle += 1 // 日志里没有任何标题线索，一律留空
    if (isSubAgent) selfCheck.subAgentSessions += 1

    sessions.push({
      id: qualify('codebuddy-cli', sid),
      rawId: sid,
      source: 'codebuddy-cli',
      isSubAgent,
      projectId,
      type: 'cli',
      chatMode: isSubAgent ? 'auxiliary' : 'cli',
      modelId: dominantModel,
      title: undefined,
      cwd,
      createdAt: list[0].ts,
      lastMessageAt: list[list.length - 1].ts,
      requests,
      totals: totalsOf(requests),
    })
  }

  sessions.sort((a, b) => a.totals.firstTs - b.totals.firstTs)
  selfCheck.requestsWithUsage = calls.size
  selfCheck.projectIndexFiles = projects.size
  selfCheck.convIndexFiles = logFilesHit
  for (const s of sessions) if (!s.requests.length) selfCheck.sessionsWithoutRequests += 1

  const coverage: Coverage = computeCoverage(sessions)
  const info: SourceInfo = {
    ...opts.sources,
    projectCount: projects.size,
    convIndexCount: logFilesHit,
    sessionMetaCount: agents.size,
    elapsedMs: opts.elapsedMs ?? 0,
  }

  const parsed: Dataset = {
    schemaVersion: 3,
    generatedAt: new Date().toISOString(),
    sources: info,
    bySource: { 'codebuddy-cli': { info, selfCheck, coverage } },
    sessions,
    selfCheck,
    coverage,
  }

  return mergeCliArchive(parsed, opts.archived)
}

/**
 * 组内第 i 条 credit 配第 i 次调用。
 * 同一份值会以 `raw_model_stream_event` 与 `response_done` 各写一遍：优先前者，
 * 只有前者缺失时才用后者兜底（否则每个 turn 的积分会被算两倍）。
 */
function pairCredits(calls: Map<string, CliCall>, credits: CreditLine[], selfCheck: SelfCheck): void {
  if (!credits.length) {
    selfCheck.requestsWithoutCredit += calls.size
    return
  }
  const byReq = new Map<string, CreditLine[]>()
  for (const c of credits) {
    const list = byReq.get(c.reqId) ?? []
    list.push(c)
    byReq.set(c.reqId, list)
  }

  const callByReq = new Map<string, CliCall[]>()
  for (const call of calls.values()) {
    const list = callByReq.get(call.reqId) ?? []
    list.push(call)
    callByReq.set(call.reqId, list)
  }

  for (const [reqId, list] of callByReq) {
    list.sort((a, b) => a.ts - b.ts)
    const raw = byReq.get(reqId) ?? []
    const preferred = raw.filter((c) => c.source === CREDIT_SOURCE)
    const chosen = (preferred.length ? preferred : raw).slice().sort(compareCredit)
    // 完全相同的 (时间, 值) 只保留一条：同一份日志被重复枚举时不能算两次
    const seen = new Set<string>()
    const unique: CreditLine[] = []
    for (const c of chosen) {
      const sig = `${c.ts ?? ''}|${c.credit}`
      if (seen.has(sig)) continue
      seen.add(sig)
      unique.push(c)
    }
    for (let i = 0; i < list.length; i++) {
      const credit = unique[i]
      if (credit) list[i].credit = credit.credit
      else selfCheck.requestsWithoutCredit += 1
    }
    if (unique.length > list.length) selfCheck.creditUnpaired += unique.length - list.length
  }

  // 完全没有请求对应的 credit（例如调用行被日志截断）
  for (const reqId of byReq.keys()) {
    if (!callByReq.has(reqId)) selfCheck.creditUnpaired += (byReq.get(reqId) ?? []).filter((c) => c.source === CREDIT_SOURCE).length
  }
}

function compareCredit(a: CreditLine, b: CreditLine): number {
  if (a.ts !== undefined && b.ts !== undefined && a.ts !== b.ts) return a.ts - b.ts
  return a.seq - b.seq
}

async function readTraceAgents(files: LazyFile[]): Promise<Map<string, TraceAgent>> {
  const out = new Map<string, TraceAgent>()
  for (const file of files) {
    if (!isCliTracePath(file.path)) continue
    let text = ''
    try {
      text = await file.read()
    } catch {
      continue
    }
    let start = 0
    while (start <= text.length) {
      let end = text.indexOf('\n', start)
      if (end === -1) end = text.length
      const line = text.slice(start, end)
      start = end + 1
      if (!line.includes('"trace_start"')) continue
      try {
        const rec = JSON.parse(line) as { trace?: { agent?: TraceAgent } }
        const agent = rec.trace?.agent
        if (agent?.sessionId) out.set(agent.sessionId, agent)
      } catch {
        /* traces 只作增强，解析失败不影响用量 */
      }
    }
  }
  return out
}

/**
 * 归档合并：日志轮转后，历史只能靠上一轮的切片续命。
 * 纯函数：按会话 id 归并、按请求 key 去重（新扫到的优先），并重算所有派生值。
 */
export function mergeCliArchive(parsed: Dataset, archived?: Dataset | null): Dataset {
  const old = archived?.sessions?.filter((s) => s.source === 'codebuddy-cli') ?? []
  if (!old.length) return parsed

  const oldById = new Map(old.map((s) => [s.rawId ?? s.id, s]))
  const merged: SessionRecord[] = []
  const seen = new Set<string>()

  for (const session of parsed.sessions) {
    const rawId = session.rawId ?? session.id
    const prev = oldById.get(rawId)
    seen.add(rawId)
    if (!prev) {
      merged.push(session)
      continue
    }
    const byKey = new Map<string, RequestRecord>()
    for (const r of prev.requests) byKey.set(r.key ?? `${r.ts}`, r)
    for (const r of session.requests) byKey.set(r.key ?? `${r.ts}`, r)
    const requests = [...byKey.values()].sort((a, b) => a.ts - b.ts)
    merged.push({
      ...session,
      cwd: session.cwd ?? prev.cwd,
      title: session.title ?? prev.title,
      isSubAgent: session.isSubAgent ?? prev.isSubAgent,
      createdAt: Math.min(session.createdAt ?? session.totals.firstTs, prev.createdAt ?? prev.totals.firstTs),
      requests,
      totals: totalsOf(requests),
    })
  }
  for (const prev of old) {
    const rawId = prev.rawId ?? prev.id
    if (seen.has(rawId)) continue
    merged.push(prev)
  }

  merged.sort((a, b) => a.totals.firstTs - b.totals.firstTs)
  const unionRequests = merged.reduce((a, s) => a + s.requests.length, 0)
  const selfCheck: SelfCheck = {
    ...parsed.selfCheck,
    requestsWithUsage: unionRequests,
    archiveRequests: Math.max(0, unionRequests - parsed.selfCheck.requestsWithUsage),
  }
  const coverage = computeCoverage(merged)
  const info: SourceInfo = {
    ...parsed.sources,
    projectCount: new Set(merged.map((s) => s.projectId)).size,
  }

  return {
    ...parsed,
    sources: info,
    bySource: { 'codebuddy-cli': { info, selfCheck, coverage } },
    sessions: merged,
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

function lastSegment(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] ?? 'unknown'
}
