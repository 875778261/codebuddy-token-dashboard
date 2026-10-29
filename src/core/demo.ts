import type { Dataset, RequestRecord, SessionRecord, SourceId } from './types'
import { computeCoverage, emptySelfCheck, totalsOf } from './parse'
import { mergeSlices } from './merge'
import { addDays, startOfDay } from './format'

/**
 * 示例数据：完全合成，不含任何真实路径与标题。
 * 目的：没有本机数据时也能验收 UI（含「端对比」）；截图与冒烟测试用它替代隐私数据。
 * 两端故意在时间上错开、共享一个项目，好让端差异卡片的四种日期带都出现。
 */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface ModelSpec {
  id: string
  weight: number
  creditPerM: number
  cacheBias: number
}

const CB_MODELS: ModelSpec[] = [
  { id: 'deepseek-v4.1-flash', weight: 0.58, creditPerM: 4.6, cacheBias: 0.985 },
  { id: 'glm-5.3-flash', weight: 0.2, creditPerM: 3.1, cacheBias: 0.97 },
  { id: 'space-bunny', weight: 0.1, creditPerM: 5.4, cacheBias: 0.94 },
  { id: 'hy4-preview', weight: 0.08, creditPerM: 9.2, cacheBias: 0.9 },
  { id: 'hy3', weight: 0.04, creditPerM: 11.5, cacheBias: 0.88 },
]

const WB_MODELS: ModelSpec[] = [
  { id: 'hy3', weight: 0.42, creditPerM: 11.5, cacheBias: 0.93 },
  { id: 'deepseek-v4.1-flash', weight: 0.28, creditPerM: 4.6, cacheBias: 0.96 },
  { id: 'glm-5.2', weight: 0.14, creditPerM: 3.6, cacheBias: 0.9 },
  { id: 'gpt-5.6-sol', weight: 0.1, creditPerM: 14.2, cacheBias: 0.88 },
  { id: 'hy4-preview', weight: 0.06, creditPerM: 9.2, cacheBias: 0.9 },
]

/** 共享项目只有一个：用来验证「两端都用」标识，且不会把不同项目误并 */
const SHARED_PROJECT = 'd:/workspace/acme/portal-web'
const CB_PROJECTS = [SHARED_PROJECT, 'd:/workspace/acme/api-gateway', 'd:/labs/agent-playground', 'c:/Users/dev/CodeBuddy/sandbox']
const WB_PROJECTS = [SHARED_PROJECT, 'd:\\work\\billing-service', 'd:\\work\\data-pipeline', 'd:\\labs\\prompt-studio', 'd:\\labs\\dashboard-kit']

const TOPICS = ['重构鉴权中间件', '修复分页边界问题', '给列表页加虚拟滚动', '补充 E2E 用例', '梳理缓存失效路径', '接入新的模型供应商', '排查构建产物体积', '把日志接入看板', '拆分超大组件', '给接口加限流']

function pickModel(rnd: () => number, models: ModelSpec[]): ModelSpec {
  let r = rnd()
  for (const m of models) {
    if (r < m.weight) return m
    r -= m.weight
  }
  return models[0]
}

interface SliceConfig {
  source: SourceId
  seed: number
  models: ModelSpec[]
  projects: string[]
  /** 0=周日 … 6=周六；决定这一天用不用这一端 */
  activeOn: (weekday: number) => boolean
  gapDays: Set<number>
  subAgentRate: number
}

function buildSlice(cfg: SliceConfig, now: number): Dataset {
  const rnd = mulberry32(cfg.seed)
  const today = startOfDay(now)
  const days = 64
  const sessions: SessionRecord[] = []
  let seq = 0

  for (let d = days - 1; d >= 0; d--) {
    if (cfg.gapDays.has(d)) continue
    const dayStart = addDays(today, -d)
    const weekday = new Date(dayStart).getDay()
    if (!cfg.activeOn(weekday)) continue
    const count = cfg.source === 'workbuddy' ? 1 + Math.floor(rnd() * 3) : 1 + Math.floor(rnd() * 2)

    for (let i = 0; i < count; i++) {
      const project = cfg.projects[Math.floor(rnd() * cfg.projects.length)]
      const model = pickModel(rnd, cfg.models)
      const isSubAgent = rnd() < cfg.subAgentRate
      const requests: RequestRecord[] = []
      const turns = 2 + Math.floor(rnd() * (cfg.source === 'workbuddy' ? 10 : 6))
      let ts = dayStart + (8 + Math.floor(rnd() * 12)) * 3600_000 + Math.floor(rnd() * 3_600_000)
      let context = 18_000 + Math.floor(rnd() * 60_000)

      for (let k = 0; k < turns; k++) {
        context = Math.min(360_000, Math.round(context * (1.16 + rnd() * 0.28)))
        const input = context
        const cache = Math.round(input * Math.min(0.995, model.cacheBias + (rnd() - 0.5) * 0.02))
        const cacheMiss = input - cache
        const output = 400 + Math.floor(rnd() * 4200)
        const total = input + output
        const credit = Math.round((total / 1e6) * model.creditPerM * 100) / 100
        const base = {
          ts,
          input,
          output,
          total,
          cache,
          cacheWrite: 0,
          cacheMiss,
          credit,
          lastTokens: output,
          creditKnown: true,
        }
        requests.push(
          cfg.source === 'workbuddy'
            ? { ...base, type: 'workbuddy', model: model.id, key: `wb-${seq}-${k}` }
            : { ...base, type: rnd() > 0.94 ? 'ask' : 'craft' },
        )
        ts += 40_000 + Math.floor(rnd() * 300_000)
      }

      const rawId = `${cfg.source === 'workbuddy' ? 'wb' : 'cb'}-${d}-${i}`
      sessions.push({
        id: `${cfg.source}:${rawId}`,
        rawId,
        source: cfg.source,
        isSubAgent,
        projectId: `hash-${project.replace(/[^a-zA-Z0-9]+/g, '-')}`,
        type: cfg.source === 'workbuddy' ? 'workbuddy' : rnd() > 0.94 ? 'ask' : 'craft',
        chatMode: isSubAgent ? 'subagent' : 'craft',
        // 请求级模型（WorkBuddy）在缺请求级字段时回落到会话级，所以两端都写主模型
        modelId: model.id,
        title: isSubAgent ? undefined : `${TOPICS[Math.floor(rnd() * TOPICS.length)]}${rnd() > 0.75 ? ' · 第二轮' : ''}`,
        cwd: project,
        status: rnd() > 0.2 ? 'Completed' : 'Aborted',
        createdAt: requests[0].ts,
        lastMessageAt: requests[requests.length - 1].ts,
        requests,
        totals: totalsOf(requests),
      })
      seq += 1
    }
  }

  sessions.sort((a, b) => a.totals.firstTs - b.totals.firstTs)
  const selfCheck = emptySelfCheck()
  selfCheck.projectIndexFiles = cfg.projects.length
  selfCheck.convIndexFiles = sessions.length
  selfCheck.requestsTotal = sessions.reduce((a, s) => a + s.requests.length, 0)
  selfCheck.requestsWithUsage = selfCheck.requestsTotal
  selfCheck.inputEqCachePlusMiss = { ok: selfCheck.requestsTotal, fail: 0 }
  selfCheck.totalEqInputPlusOutput = { ok: selfCheck.requestsTotal, fail: 0 }
  selfCheck.sessionsWithoutTitle = sessions.filter((s) => !s.title).length
  selfCheck.sessionsUnknownModel = sessions.filter((s) => !s.modelId && !s.isSubAgent).length
  selfCheck.subAgentSessions = sessions.filter((s) => s.isSubAgent).length
  const coverage = computeCoverage(sessions)

  return {
    schemaVersion: 2,
    isDemo: true,
    generatedAt: new Date(now).toISOString(),
    sources: {
      historyRoots: [cfg.source === 'workbuddy' ? '（示例数据）~/.workbuddy/projects' : '（示例数据）CodeBuddyExtension/Data/…/history'],
      projectCount: cfg.projects.length,
      convIndexCount: sessions.length,
      sessionMetaCount: sessions.length,
      sessionsDb: cfg.source === 'codebuddy' ? '（示例数据）codebuddy-sessions.vscdb' : undefined,
      scannedAt: new Date(now).toISOString(),
      elapsedMs: 42,
    },
    bySource: {
      [cfg.source]: {
        info: {
          historyRoots: [cfg.source === 'workbuddy' ? '（示例数据）~/.workbuddy/projects' : '（示例数据）CodeBuddyExtension/Data/…/history'],
          projectCount: cfg.projects.length,
          convIndexCount: sessions.length,
          sessionMetaCount: sessions.length,
          sessionsDb: cfg.source === 'codebuddy' ? '（示例数据）codebuddy-sessions.vscdb' : undefined,
          scannedAt: new Date(now).toISOString(),
          elapsedMs: 42,
        },
        selfCheck,
        coverage,
      },
    },
    sessions,
    selfCheck,
    coverage,
  }
}

export function buildDemoDataset(now = Date.now()): Dataset {
  const codebuddy = buildSlice(
    {
      source: 'codebuddy',
      seed: 20261029,
      models: CB_MODELS,
      projects: CB_PROJECTS,
      // 周末基本只用 CodeBuddy：让「切换使用」在图上看得出来
      activeOn: (w) => w === 0 || w === 6 || w % 3 !== 0,
      gapDays: new Set([52, 53, 21]),
      subAgentRate: 0,
    },
    now,
  )
  const workbuddy = buildSlice(
    {
      source: 'workbuddy',
      seed: 77123,
      models: WB_MODELS,
      projects: WB_PROJECTS,
      activeOn: (w) => w !== 0 && w % 4 !== 2,
      gapDays: new Set([49, 50, 21, 8]),
      subAgentRate: 0.12,
    },
    now,
  )
  const merged = mergeSlices([codebuddy, workbuddy])
  return { ...merged, isDemo: true }
}
