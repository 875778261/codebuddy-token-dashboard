import type { Dataset, RequestRecord, SessionRecord, SessionTotals } from './types'
import { computeCoverage } from './parse'
import { addDays, startOfDay } from './format'

/**
 * 示例数据：完全合成，不含任何真实路径与标题。
 * 目的：没有本机数据时也能验收 UI；截图与冒烟测试用它替代隐私数据。
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

const MODELS = [
  { id: 'deepseek-v4.1-flash', weight: 0.58, creditPerM: 4.6, cacheBias: 0.985 },
  { id: 'glm-5.3-flash', weight: 0.2, creditPerM: 3.1, cacheBias: 0.97 },
  { id: 'space-bunny', weight: 0.1, creditPerM: 5.4, cacheBias: 0.94 },
  { id: 'hy4-preview', weight: 0.06, creditPerM: 9.2, cacheBias: 0.9 },
  { id: 'hy3', weight: 0.04, creditPerM: 11.5, cacheBias: 0.88 },
  { id: 'auto', weight: 0.02, creditPerM: 6.0, cacheBias: 0.92 },
]

const PROJECTS = [
  { cwd: 'd:/workspace/acme/portal-web', label: 'portal-web' },
  { cwd: 'd:/workspace/acme/api-gateway', label: 'api-gateway' },
  { cwd: 'd:/labs/agent-playground', label: 'agent-playground' },
  { cwd: 'd:/labs/dashboard-kit', label: 'dashboard-kit' },
  { cwd: 'c:/Users/dev/CodeBuddy/sandbox', label: 'sandbox' },
]

const TOPICS = [
  '重构鉴权中间件',
  '修复分页边界问题',
  '给列表页加虚拟滚动',
  '补充 E2E 用例',
  '梳理缓存失效路径',
  '接入新的模型供应商',
  '排查构建产物体积',
  '把日志接入看板',
  '设计用量快照格式',
  '拆分超大组件',
  '给接口加限流',
  '校对埋点口径',
]

function totalsOf(requests: RequestRecord[]): SessionTotals {
  const t: SessionTotals = {
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
  for (const r of requests) {
    t.requests += 1
    t.total += r.total
    t.input += r.input
    t.output += r.output
    t.cache += r.cache
    t.cacheMiss += r.cacheMiss
    t.credit += r.credit
    t.firstTs = Math.min(t.firstTs, r.ts)
    t.lastTs = Math.max(t.lastTs, r.ts)
  }
  return t
}

export function buildDemoDataset(now = Date.now()): Dataset {
  const rnd = mulberry32(20261029)
  const today = startOfDay(now)
  const days = 64
  const sessions: SessionRecord[] = []
  // 故意留三个空洞，用来检验"缺失天"提示不是摆设
  const gapDays = new Set([52, 53, 21])

  for (let d = days - 1; d >= 0; d--) {
    if (gapDays.has(d)) continue
    const dayStart = addDays(today, -d)
    const weekday = new Date(dayStart).getDay()
    const weekend = weekday === 0 || weekday === 6
    const count = weekend ? 1 + Math.floor(rnd() * 2) : 2 + Math.floor(rnd() * 4)
    for (let i = 0; i < count; i++) {
      const project = PROJECTS[Math.floor(rnd() * PROJECTS.length)]
      const model = pickModel(rnd)
      const requests: RequestRecord[] = []
      const turns = 2 + Math.floor(rnd() * 14)
      let ts = dayStart + (8 + Math.floor(rnd() * 13)) * 3600_000 + Math.floor(rnd() * 3_600_000)
      let context = 18_000 + Math.floor(rnd() * 60_000)
      for (let k = 0; k < turns; k++) {
        context = Math.min(360_000, Math.round(context * (1.18 + rnd() * 0.3)))
        const input = context
        const cache = Math.round(input * Math.min(0.995, model.cacheBias + (rnd() - 0.5) * 0.02))
        const cacheMiss = input - cache
        const output = 400 + Math.floor(rnd() * 4200)
        const total = input + output
        const credit = Math.round(((total / 1e6) * model.creditPerM * 100)) / 100
        requests.push({
          ts,
          type: rnd() > 0.97 ? 'ask' : 'craft',
          input,
          output,
          total,
          cache,
          cacheWrite: 0,
          cacheMiss,
          credit,
          lastTokens: output,
        })
        ts += 40_000 + Math.floor(rnd() * 300_000)
      }
      sessions.push({
        id: `demo-${d}-${i}`,
        projectId: `hash-${project.label}`,
        type: 'craft',
        chatMode: 'craft',
        modelId: model.id,
        title: `${TOPICS[Math.floor(rnd() * TOPICS.length)]}${rnd() > 0.72 ? ' · 第二轮' : ''}`,
        cwd: project.cwd,
        status: rnd() > 0.2 ? 'Completed' : 'Aborted',
        createdAt: requests[0].ts,
        lastMessageAt: requests[requests.length - 1].ts,
        requests,
        totals: totalsOf(requests),
      })
    }
  }

  sessions.sort((a, b) => a.totals.firstTs - b.totals.firstTs)

  const requestsTotal = sessions.reduce((a, s) => a + s.requests.length, 0)
  const dataset: Dataset = {
    schemaVersion: 1,
    isDemo: true,
    generatedAt: new Date(now).toISOString(),
    sources: {
      historyRoots: ['（示例数据）CodeBuddyExtension/Data/…/history'],
      projectCount: PROJECTS.length,
      convIndexCount: sessions.length,
      sessionMetaCount: sessions.length,
      sessionsDb: '（示例数据）codebuddy-sessions.vscdb',
      scannedAt: new Date(now).toISOString(),
      elapsedMs: 42,
    },
    sessions,
    selfCheck: {
      projectIndexFiles: PROJECTS.length,
      convIndexFiles: sessions.length,
      parseErrors: 0,
      requestsTotal,
      requestsWithUsage: requestsTotal,
      inFlightSkipped: 1,
      inputEqCachePlusMiss: { ok: requestsTotal, fail: 0 },
      totalEqInputPlusOutput: { ok: requestsTotal, fail: 0 },
      sessionsWithoutRequests: 0,
      sessionsUnknownModel: 0,
      sessionsWithoutCwd: 0,
      sessionsWithoutTitle: 0,
    },
    coverage: computeCoverage(sessions),
  }
  return dataset
}

function pickModel(rnd: () => number) {
  let r = rnd()
  for (const m of MODELS) {
    if (r < m.weight) return m
    r -= m.weight
  }
  return MODELS[0]
}
