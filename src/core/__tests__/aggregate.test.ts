import { describe, expect, it } from 'vitest'
import { aggregate, makeCustomWindow, makeWindow } from '../aggregate'
import { buildDemoDataset } from '../demo'
import type { Dataset, RequestRecord, SessionRecord } from '../types'

function req(ts: number, total: number, cache = 0, credit = 0, type = 'craft'): RequestRecord {
  return { ts, type, input: total, output: 0, total, cache, cacheMiss: total - cache, cacheWrite: 0, credit, lastTokens: 0 }
}

function session(id: string, cwd: string, modelId: string | undefined, requests: RequestRecord[]): SessionRecord {
  return {
    id,
    projectId: `hash-${id}`,
    type: 'craft',
    modelId,
    title: id,
    cwd,
    requests,
    totals: {
      requests: requests.length,
      total: requests.reduce((a, r) => a + r.total, 0),
      input: requests.reduce((a, r) => a + r.input, 0),
      output: 0,
      cache: requests.reduce((a, r) => a + r.cache, 0),
      cacheMiss: requests.reduce((a, r) => a + r.cacheMiss, 0),
      cacheWrite: 0,
      credit: requests.reduce((a, r) => a + r.credit, 0),
      firstTs: requests[0].ts,
      lastTs: requests[requests.length - 1].ts,
    },
  }
}

const day = (iso: string) => new Date(`${iso}T10:00:00`).getTime()

function dataset(): Dataset {
  return {
    schemaVersion: 1,
    generatedAt: '2026-10-29T00:00:00.000Z',
    sources: { historyRoots: [], projectCount: 1, convIndexCount: 2, sessionMetaCount: 2, scannedAt: '', elapsedMs: 0 },
    sessions: [
      session('a', 'd:/w/alpha', 'model-a', [req(day('2026-10-01'), 100, 90, 1), req(day('2026-10-02'), 200, 190, 2)]),
      session('b', 'd:/w/beta', undefined, [req(day('2026-10-02'), 50, 40, 0, 'ask')]),
      session('c', 'd:/w/alpha', 'model-b', [req(day('2026-10-09'), 1000, 500, 5)]),
    ],
    selfCheck: {
      projectIndexFiles: 1,
      convIndexFiles: 3,
      parseErrors: 0,
      requestsTotal: 4,
      requestsWithUsage: 4,
      inFlightSkipped: 0,
      inputEqCachePlusMiss: { ok: 4, fail: 0 },
      totalEqInputPlusOutput: { ok: 4, fail: 0 },
      sessionsWithoutRequests: 0,
      sessionsUnknownModel: 1,
      sessionsWithoutCwd: 0,
      sessionsWithoutTitle: 0,
    },
    coverage: { first: '2026-10-01', last: '2026-10-09', daysWithData: 3, daysInRange: 9, missingDays: [] },
  }
}

describe('aggregate', () => {
  it('按窗口裁剪请求，并把空档日补齐', () => {
    const win = makeCustomWindow('2026-10-01', '2026-10-03')
    const agg = aggregate(dataset(), win)
    expect(agg.totals.requests).toBe(3)
    expect(agg.totals.total).toBe(350)
    expect(agg.days).toHaveLength(3)
    expect(agg.days.map((d) => d.requests)).toEqual([1, 2, 0])
    expect(agg.totals.sessions).toBe(2)
    expect(agg.totals.activeDays).toBe(2)
  })

  it('模型与会话按会话级 modelId 归属，缺失归入"未记录模型"', () => {
    const agg = aggregate(dataset(), makeCustomWindow('2026-10-01', '2026-10-09'))
    expect(agg.models.map((m) => m.key)).toEqual(['model-b', 'model-a', '未记录模型'])
    expect(agg.models.find((m) => m.key === '未记录模型')!.total).toBe(50)
    expect(agg.models.find((m) => m.key === 'model-a')!.cacheHitRate).toBeCloseTo(280 / 300)
  })

  it('项目按 cwd 聚合，sparkline 与 days 对齐', () => {
    const agg = aggregate(dataset(), makeCustomWindow('2026-10-01', '2026-10-09'))
    expect(agg.projects[0].name).toBe('alpha')
    expect(agg.projects[0].total).toBe(1300)
    expect(agg.projects[0].sparkline).toHaveLength(9)
    expect(agg.projects[0].sparkline.reduce((a, b) => a + b, 0)).toBe(1300)
  })

  it('时段矩阵按周一为首列累计', () => {
    const agg = aggregate(dataset(), makeCustomWindow('2026-10-01', '2026-10-09'))
    const sum = agg.heat.flat().reduce((a, b) => a + b, 0)
    expect(sum).toBe(1350)
    // 2026-10-01 是周四 → 索引 3
    expect(agg.heat[3][10]).toBe(100)
  })

  it('上期对比：等长窗口才有，且上期无数据时为空', () => {
    const ds = dataset()
    const presetWin = makeWindow('7', ds.coverage.first, new Date('2026-10-10T12:00:00').getTime())
    const agg = aggregate(ds, presetWin)
    expect(agg.window.days).toBe(7)
    // 窗口 10-05 → 10-11，上期 09-28 → 10-05，命中 10-01/02 的三条请求
    expect(agg.prev?.requests).toBe(3)
    expect(agg.prev?.total).toBe(350)

    const emptyPrev = aggregate(ds, { ...presetWin, prevStart: day('2026-09-01'), prevEnd: day('2026-09-08') })
    expect(emptyPrev.prev).toBeUndefined()
  })

  it('示例数据可被完整聚合，且没有解析缺口', () => {
    const demo = buildDemoDataset(new Date('2026-10-29T12:00:00').getTime())
    const agg = aggregate(demo, makeWindow('all', demo.coverage.first, new Date('2026-10-29T12:00:00').getTime()))
    expect(demo.sessions.length).toBeGreaterThan(50)
    expect(agg.totals.requests).toBe(demo.selfCheck.requestsWithUsage)
    expect(agg.totals.cache).toBeLessThanOrEqual(agg.totals.input)
    expect(agg.modelDaily[0].values).toHaveLength(agg.days.length)
  })
})
