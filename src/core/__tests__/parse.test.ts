import { describe, expect, it } from 'vitest'
import { applySessionMeta, buildDataset, type ScannedFile } from '../parse'

const projectIndex = (convs: Array<Record<string, unknown>>) => JSON.stringify({ conversations: convs, current: convs[0]?.id })

const convIndex = (requests: Array<Record<string, unknown>>) => JSON.stringify({ messages: [], requests })

const path = (project: string, conv: string): string[] => ['uid', 'CodeBuddyIDE', 'uid', 'history', project, conv, 'index.json']

const usage = (input: number, output: number, cache: number, credit: number) => ({
  inputTokens: input,
  outputTokens: output,
  totalTokens: input + output,
  lastTokens: output,
  cacheTokens: cache,
  cachedWriteTokens: 0,
  cachedMissTokens: input - cache,
  credit,
})

function files(): ScannedFile[] {
  return [
    {
      path: ['uid', 'CodeBuddyIDE', 'uid', 'history', 'projA', 'index.json'],
      text: projectIndex([
        { id: 'c1', type: 'craft', name: '重构鉴权', createdAt: '2026-10-01T02:00:00.000Z', selectedModelId: 'model-x' },
        { id: 'c2', type: 'ask', name: '解释代码', createdAt: '2026-10-02T02:00:00.000Z' },
      ]),
    },
    {
      path: path('projA', 'c1'),
      text: convIndex([
        { id: 'r1', type: 'craft', state: 'complete', startedAt: 1000, usage: usage(100, 10, 80, 1.5) },
        { id: 'r2', type: 'craft', state: 'complete', startedAt: 2000, usage: usage(200, 20, 150, 2.25) },
        // 在途请求：既无 usage 也无 startedAt
        { id: 'r3', type: 'craft', messages: [] },
      ]),
    },
    {
      path: path('projA', 'c2'),
      text: convIndex([
        { id: 'r4', type: 'ask', state: 'complete', startedAt: 3000, usage: usage(50, 5, 20, 0) },
        { id: 'r5', type: 'ask', state: 'complete', startedAt: 4000, usage: usage(60, 6, 30, 0) },
      ]),
    },
    {
      path: path('projB', 'c3'),
      text: convIndex([{ id: 'r6', type: 'craft', state: 'complete', startedAt: 5000, usage: usage(1000, 100, 900, 10) }]),
    },
    // 空会话：只有 messages，没有 requests
    { path: path('projB', 'c4'), text: JSON.stringify({ messages: [], requests: [] }) },
    // 脏文件
    { path: path('projB', 'c5'), text: '{ not json' },
  ]
}

describe('buildDataset', () => {
  const ds = buildDataset({
    files: files(),
    sessionMeta: [
      { conversationId: 'c1', title: '重构鉴权中间件', cwd: 'd:/work/portal', status: 'Completed' },
      { conversationId: 'c2', title: '解释代码', cwd: 'd:/work/portal', status: 'Completed' },
    ],
    sources: { historyRoots: [], scannedAt: '2026-10-29T00:00:00.000Z' },
    elapsedMs: 1,
  })

  it('按 usage 存在为唯一准入条件，跳过在途请求', () => {
    expect(ds.selfCheck.requestsTotal).toBe(6)
    expect(ds.selfCheck.requestsWithUsage).toBe(5)
    expect(ds.selfCheck.inFlightSkipped).toBe(1)
    expect(ds.sessions).toHaveLength(3)
  })

  it('两条恒等式在全部请求上成立', () => {
    expect(ds.selfCheck.inputEqCachePlusMiss).toEqual({ ok: 5, fail: 0 })
    expect(ds.selfCheck.totalEqInputPlusOutput).toEqual({ ok: 5, fail: 0 })
  })

  it('汇总与逐会话合计一致', () => {
    const sum = ds.sessions.reduce((a, s) => a + s.totals.total, 0)
    expect(sum).toBe(100 + 10 + 200 + 20 + 50 + 5 + 60 + 6 + 1000 + 100)
    const credit = ds.sessions.reduce((a, s) => a + s.totals.credit, 0)
    expect(credit).toBeCloseTo(13.75, 5)
  })

  it('会话元数据：标题/路径来自会话库，模型来自项目索引', () => {
    const c1 = ds.sessions.find((s) => s.id === 'c1')!
    expect(c1.title).toBe('重构鉴权中间件')
    expect(c1.cwd).toBe('d:/work/portal')
    expect(c1.modelId).toBe('model-x')
    expect(c1.type).toBe('craft')
    expect(ds.selfCheck.sessionsWithoutCwd).toBe(1)
    expect(ds.selfCheck.sessionsUnknownModel).toBe(2)
  })

  it('空会话与脏文件分别计入统计，不污染请求数', () => {
    expect(ds.selfCheck.sessionsWithoutRequests).toBe(1)
    expect(ds.selfCheck.parseErrors).toBe(1)
    expect(ds.selfCheck.projectIndexFiles).toBe(1)
    expect(ds.selfCheck.convIndexFiles).toBe(4)
  })

  it('覆盖率按最早/最晚请求的日期区间计算', () => {
    expect(ds.coverage.daysWithData).toBe(1)
    expect(ds.coverage.daysInRange).toBe(1)
  })

  it('事后补充会话库只补元数据，不动 token 与请求数', () => {
    const before = buildDataset({
      files: files(),
      sources: { historyRoots: [], scannedAt: '2026-10-29T00:00:00.000Z' },
      elapsedMs: 1,
    })
    expect(before.selfCheck.sessionsWithoutCwd).toBe(3)

    const after = applySessionMeta(
      before,
      [
        { conversationId: 'c1', title: '重构鉴权中间件', cwd: 'd:/work/portal', status: 'Completed' },
        { conversationId: 'c3', title: '另一个会话', cwd: 'd:/work/other' },
      ],
      'codebuddy-sessions.vscdb',
    )

    expect(after.sessions.find((s) => s.id === 'c1')!.cwd).toBe('d:/work/portal')
    expect(after.sessions.find((s) => s.id === 'c3')!.title).toBe('另一个会话')
    expect(after.sessions.find((s) => s.id === 'c2')!.title).toBe('解释代码') // 原有回退标题保留
    expect(after.selfCheck.sessionsWithoutCwd).toBe(1)
    expect(after.sources.sessionMetaCount).toBe(2)
    expect(after.sources.sessionsDb).toBe('codebuddy-sessions.vscdb')
    expect(after.selfCheck.requestsWithUsage).toBe(before.selfCheck.requestsWithUsage)
    expect(after.sessions.reduce((a, s) => a + s.totals.total, 0)).toBe(before.sessions.reduce((a, s) => a + s.totals.total, 0))
  })
})
