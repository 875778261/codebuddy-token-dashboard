/** 数据契约：所有字段名对齐 CodeBuddy 本地文件的真实字段，不做臆造。 */

export interface Usage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  lastTokens: number
  cacheTokens: number
  cachedWriteTokens: number
  cachedMissTokens: number
  credit: number
}

/** history/<projectHash>/<convId>/index.json 的 requests[] 元素 */
export interface RawRequest {
  id?: string
  type?: string
  state?: string
  startedAt?: number
  usage?: Partial<Usage>
}

export interface RawMessageRef {
  id: string
  role?: string
  type?: string
  isComplete?: boolean
}

/** 会话级 index.json：顶层字段只有 messages 与 requests */
export interface ConvIndexDoc {
  messages?: RawMessageRef[]
  requests?: RawRequest[]
}

/** 项目级 index.json 的 conversations[] 元素 */
export interface ProjectConvMeta {
  id: string
  type?: string
  name?: string
  createdAt?: string
  lastMessageAt?: string
  chatMode?: string
  selectedModelId?: string
  selectionRevision?: number
}

export interface ProjectIndexDoc {
  conversations?: ProjectConvMeta[]
  current?: string
}

/** codebuddy-sessions.vscdb → ItemTable key='session:<conversationId>' 的 JSON */
export interface SessionMeta {
  conversationId: string
  cwd?: string
  userId?: string
  title?: string
  status?: string
  createdAt?: number
  updatedAt?: number
  isPlayground?: boolean
}

/** 规范化后的单条请求（里程碑：ts 毫秒） */
export interface RequestRecord {
  ts: number
  type: string
  input: number
  output: number
  total: number
  cache: number
  cacheWrite: number
  cacheMiss: number
  credit: number
  lastTokens: number
}

export interface SessionRecord {
  id: string
  /** history 目录名（项目 hash），仅在拿不到 cwd 时用于分组 */
  projectId: string
  /** craft | ask */
  type: string
  chatMode?: string
  /** 会话级 selectedModelId（覆盖率约 6 成，非请求级） */
  modelId?: string
  title?: string
  cwd?: string
  status?: string
  createdAt?: number
  lastMessageAt?: number
  requests: RequestRecord[]
  /** 冗余聚合，避免每次渲染重复求和 */
  totals: SessionTotals
}

export interface SessionTotals {
  requests: number
  total: number
  input: number
  output: number
  cache: number
  cacheMiss: number
  cacheWrite: number
  credit: number
  firstTs: number
  lastTs: number
}

export interface CountPair {
  ok: number
  fail: number
}

/** 解析期自检：任一 fail > 0 即视为解析 bug，而不是"数据缺失" */
export interface SelfCheck {
  projectIndexFiles: number
  convIndexFiles: number
  parseErrors: number
  requestsTotal: number
  requestsWithUsage: number
  /** 在途请求：有 usage 但无 startedAt，或两者皆无 */
  inFlightSkipped: number
  inputEqCachePlusMiss: CountPair
  totalEqInputPlusOutput: CountPair
  sessionsWithoutRequests: number
  sessionsUnknownModel: number
  sessionsWithoutCwd: number
  sessionsWithoutTitle: number
}

export interface Coverage {
  first?: string
  last?: string
  daysWithData: number
  daysInRange: number
  missingDays: string[]
}

export interface SourceInfo {
  /** 实际扫到的 history 根（相对用户所选目录） */
  historyRoots: string[]
  projectCount: number
  convIndexCount: number
  sessionsDb?: string
  sessionMetaCount: number
  scannedAt: string
  /** 解析耗时（毫秒） */
  elapsedMs: number
}

export interface Dataset {
  schemaVersion: 1
  generatedAt: string
  sources: SourceInfo
  sessions: SessionRecord[]
  selfCheck: SelfCheck
  coverage: Coverage
  /** 合成示例数据：只在内存里预览，不写缓存、不可当作真实用量 */
  isDemo?: boolean
}

export type ModelKey = string
