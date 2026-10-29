/** 数据契约：所有字段名对齐 CodeBuddy / WorkBuddy 本地文件的真实字段，不做臆造。 */

export type SourceId = 'codebuddy' | 'workbuddy'

/** 源顺序：所有按源排列的 UI 与图例都用它，避免各处顺序不一致 */
export const SOURCE_ORDER: SourceId[] = ['codebuddy', 'workbuddy']

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
  /** CodeBuddy: craft | ask；WorkBuddy: workbuddy（不硬套 craft/ask） */
  type: string
  input: number
  output: number
  total: number
  cache: number
  cacheWrite: number
  cacheMiss: number
  credit: number
  lastTokens: number
  /** 请求级模型（WorkBuddy 自带）；缺省时由聚合层回落到会话级 modelId */
  model?: string
  /** 源内去重键 `${sessionId}:${messageId}`，WorkBuddy 用于丢弃重试双写 */
  key?: string
  /** credit 字段是否真实存在：区分「记到 0 积分」与「没有积分字段」 */
  creditKnown?: boolean
}

export interface SessionRecord {
  /** 全局唯一：`${source}:${rawId}`，跨源绝不可能静默合并 */
  id: string
  /** 源内原始会话 id（vscdb 元数据按它匹配） */
  rawId?: string
  source: SourceId
  /** 由主会话派生的子智能体会话（WorkBuddy 的 subagents/） */
  isSubAgent?: boolean
  /**
   * 跨源归一化后的项目 key（`\`→`/` + 去尾斜杠，大小写保留）。
   * 由合并层写入；单源数据集也应经过合并层，保证三种输入模式口径一致。
   */
  projectKey?: string
  /** history 目录名（项目 hash），仅在拿不到 cwd 时用于分组 */
  projectId: string
  /** craft | ask | workbuddy */
  type: string
  chatMode?: string
  /** 会话级 selectedModelId（CodeBuddy 覆盖率约 6 成，非请求级） */
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
  /** 在途请求：有 usage 但无 startedAt/timestamp，或两者皆无 */
  inFlightSkipped: number
  inputEqCachePlusMiss: CountPair
  totalEqInputPlusOutput: CountPair
  sessionsWithoutRequests: number
  sessionsUnknownModel: number
  sessionsWithoutCwd: number
  sessionsWithoutTitle: number
  /** credit 字段缺失的请求数（≠ 积分为 0） */
  requestsWithoutCredit: number
  /** 源内 (sessionId,messageId) 重复被丢弃的记录数（WorkBuddy） */
  duplicateRequests: number
  /** usage 整组全零、回落 rawUsage 的次数（WorkBuddy） */
  usageZeroFallbacks: number
  /** subagent 会话数 */
  subAgentSessions: number
  /** 归一后同 key 不同原串的项目数：只告警，不自动合并 */
  suspectedDuplicateProjects: number
}

export interface Coverage {
  first?: string
  last?: string
  daysWithData: number
  daysInRange: number
  /** 语义是「无记录日」（该源没有任何请求），不是数据缺失 */
  missingDays: string[]
}

export interface SourceInfo {
  /** 实际扫到的数据根（相对用户所选目录） */
  historyRoots: string[]
  projectCount: number
  convIndexCount: number
  sessionsDb?: string
  sessionMetaCount: number
  scannedAt: string
  /** 解析耗时（毫秒） */
  elapsedMs: number
}

/** 单个源的溯源信息 + 自检 + 覆盖，供数据体检与端对比使用 */
export interface SourceSummary {
  info: SourceInfo
  selfCheck: SelfCheck
  coverage: Coverage
}

export interface Dataset {
  schemaVersion: 2
  generatedAt: string
  /** 合并后的采集源汇总（各源计数相加、根目录取并集） */
  sources: SourceInfo
  /** 按源保留的溯源与自检；合并视图的 sources/selfCheck/coverage 由它汇总而来 */
  bySource: Partial<Record<SourceId, SourceSummary>>
  sessions: SessionRecord[]
  /** 合并后的自检（各源计数相加，suspectedDuplicateProjects 在合并层重算） */
  selfCheck: SelfCheck
  /** 合并后的覆盖（两源并集 → missingDays 即「无记录日」） */
  coverage: Coverage
  /** 合成示例数据：只在内存里预览，不写缓存、不可当作真实用量 */
  isDemo?: boolean
}

export type ModelKey = string

/** 源在 UI 上的固定文案与短标签 */
export const SOURCE_META: Record<SourceId, { label: string; short: string }> = {
  codebuddy: { label: 'CodeBuddy', short: 'CB' },
  workbuddy: { label: 'WorkBuddy', short: 'WB' },
}
