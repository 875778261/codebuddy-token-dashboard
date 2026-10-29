import { describe, expect, it } from 'vitest'
import { mergeSlices, normalizeDataset, normalizeProjectPath, splitBySource } from '../merge'
import { computeCoverage, emptySelfCheck } from '../parse'
import type { Dataset, RequestRecord, SessionRecord, SourceId } from '../types'

const day = (iso: string) => new Date(`${iso}T10:00:00`).getTime()

function req(ts: number, total: number, patch: Partial<RequestRecord> = {}): RequestRecord {
  return { ts, type: 'craft', input: total, output: 0, total, cache: 0, cacheMiss: total, cacheWrite: 0, credit: 0, lastTokens: 0, creditKnown: true, ...patch }
}

function slice(source: SourceId, rawId: string, cwd: string, requests: RequestRecord[]): Dataset {
  const session: SessionRecord = {
    id: `${source}:${rawId}`,
    rawId,
    source,
    projectId: 'p',
    type: source === 'workbuddy' ? 'workbuddy' : 'craft',
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
  const info = { historyRoots: [`${source}/root`], projectCount: 1, convIndexCount: 1, sessionMetaCount: 0, scannedAt: '2026-10-29T00:00:00.000Z', elapsedMs: 5 }
  const coverage = computeCoverage([session])
  const selfCheck = { ...emptySelfCheck(), requestsTotal: requests.length, requestsWithUsage: requests.length }
  return {
    schemaVersion: 2,
    generatedAt: '2026-10-29T00:00:00.000Z',
    sources: info,
    bySource: { [source]: { info, selfCheck, coverage } },
    sessions: [session],
    selfCheck,
    coverage,
  }
}

describe('normalizeProjectPath', () => {
  it('统一分隔符与尾斜杠，但保留大小写', () => {
    expect(normalizeProjectPath('d:\\WORK_SPACE\\YLTS\\ylts-web\\')).toBe('d:/WORK_SPACE/YLTS/ylts-web')
    expect(normalizeProjectPath('d:/WORK_SPACE/YLTS/ylts-web')).toBe('d:/WORK_SPACE/YLTS/ylts-web')
  })

  it('大小写不同视为不同项目（宁可裂开，绝不误并）', () => {
    expect(normalizeProjectPath('D:/w/app')).not.toBe(normalizeProjectPath('d:/w/app'))
  })
})

describe('mergeSlices', () => {
  it('两源相加，且不跨源去重（裸 UUID 相同也保持两条）', () => {
    const a = slice('codebuddy', 'same-uuid', 'd:/w/app', [req(day('2026-10-01'), 100)])
    const b = slice('workbuddy', 'same-uuid', 'd:\\w\\app', [req(day('2026-10-02'), 50)])
    const merged = mergeSlices([a, b])
    expect(merged.sessions).toHaveLength(2)
    expect(merged.sessions.map((s) => s.id)).toEqual(['codebuddy:same-uuid', 'workbuddy:same-uuid'])
    expect(merged.coverage.daysWithData).toBe(2)
  })

  it('分隔符不同的同一路径归成一个项目，但原始字符串差异必须留痕（疑似同项目）', () => {
    const a = slice('codebuddy', 'a', 'd:/w/app', [req(day('2026-10-01'), 100)])
    const b = slice('workbuddy', 'b', 'd:\\w\\app', [req(day('2026-10-01'), 50)])
    const merged = mergeSlices([a, b])
    const keys = new Set(merged.sessions.map((s) => s.projectKey))
    expect(keys.size).toBe(1)
    expect([...keys][0]).toBe('d:/w/app')
    expect(merged.selfCheck.suspectedDuplicateProjects).toBe(1)
  })

  it('大小写不同仍是两个项目（宁可裂开，绝不误并）', () => {
    const a = slice('codebuddy', 'a', 'd:/w/app', [req(day('2026-10-01'), 100)])
    const b = slice('workbuddy', 'b', 'd:/w/App', [req(day('2026-10-01'), 50)])
    const merged = mergeSlices([a, b])
    expect(merged.sessions.map((s) => s.projectKey)).toEqual(['d:/w/app', 'd:/w/App'])
    expect(merged.selfCheck.suspectedDuplicateProjects).toBe(0)
  })

  it('单源也走合并层：数字不变，bySource 保留', () => {
    const a = slice('codebuddy', 'a', 'd:/w/app', [req(day('2026-10-01'), 100)])
    const merged = mergeSlices([a])
    expect(merged.sessions).toHaveLength(1)
    expect(merged.bySource.codebuddy).toBeTruthy()
    expect(merged.bySource.workbuddy).toBeUndefined()
    expect(merged.selfCheck.requestsWithUsage).toBe(1)
    expect(merged.sessions[0].totals.total).toBe(100)
  })

  it('同源重复输入按替换语义处理，不累加', () => {
    const a = slice('codebuddy', 'a', 'd:/w/app', [req(day('2026-10-01'), 100)])
    const b = slice('codebuddy', 'a', 'd:/w/app', [req(day('2026-10-01'), 100)])
    const merged = mergeSlices([a, b])
    expect(merged.sessions).toHaveLength(1)
  })
})

describe('normalizeDataset（旧快照迁移）', () => {
  it('v1 数据没有 source/rawId：补成 codebuddy 并加前缀', () => {
    const legacy = slice('codebuddy', 'x', 'd:/w/app', [req(day('2026-10-01'), 10)])
    const raw = { ...legacy, schemaVersion: 2 } as unknown as Dataset
    delete (raw.sessions[0] as Partial<SessionRecord>).source
    delete (raw.sessions[0] as Partial<SessionRecord>).rawId
    raw.sessions[0].id = 'bare-uuid'
    const fixed = normalizeDataset(raw)
    expect(fixed.sessions[0].source).toBe('codebuddy')
    expect(fixed.sessions[0].id).toBe('codebuddy:bare-uuid')
    expect(fixed.sessions[0].rawId).toBe('bare-uuid')
  })

  it('splitBySource 把合并快照拆回两个切片，且不重复计算源信息', () => {
    const a = slice('codebuddy', 'a', 'd:/w/app', [req(day('2026-10-01'), 100)])
    const b = slice('workbuddy', 'b', 'd:\\w\\app', [req(day('2026-10-02'), 50)])
    const merged = mergeSlices([a, b])
    const split = splitBySource(merged)
    expect(Object.keys(split).sort()).toEqual(['codebuddy', 'workbuddy'])
    expect(split.codebuddy!.sessions).toHaveLength(1)
    expect(split.workbuddy!.sessions).toHaveLength(1)
    expect(split.codebuddy!.sources.projectCount).toBe(1)
  })
})
