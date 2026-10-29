import { describe, expect, it } from 'vitest'
import { parseWorkbuddy } from '../workbuddyParse'
import type { LazyFile } from '../parse'

const line = (o: unknown) => JSON.stringify(o)

const base = { type: 'function_call', sessionId: 's1', cwd: 'd:\\w\\p' }

const m1 = {
  ...base,
  timestamp: 1000,
  providerData: {
    messageId: 'm1',
    model: 'glm-5.2-x',
    usage: { requests: 1, inputTokens: 100, outputTokens: 10, totalTokens: 110, inputTokensDetails: [{ cached_tokens: 80 }] },
    rawUsage: { credit: 1.5, prompt_cache_hit_tokens: 80, prompt_cache_miss_tokens: 20 },
  },
}

// 同 (sessionId, messageId) 的重试双写：保留 timestamp 更大的那条
const m1retry = {
  ...base,
  timestamp: 2000,
  providerData: {
    messageId: 'm1',
    model: 'glm-5.2-x',
    usage: { requests: 1, inputTokens: 110, outputTokens: 10, totalTokens: 120, inputTokensDetails: [{ cached_tokens: 80 }] },
    rawUsage: { credit: 2, prompt_cache_hit_tokens: 80, prompt_cache_miss_tokens: 30 },
  },
}

// usage 整组全零 → 整组回落 rawUsage
const zeroUsage = {
  ...base,
  timestamp: 3000,
  providerData: {
    messageId: 'm2',
    model: 'sensenova-6.8-flash-lite',
    usage: { requests: 1, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    rawUsage: { prompt_tokens: 50, completion_tokens: 5, total_tokens: 55, prompt_cache_hit_tokens: 40, prompt_cache_miss_tokens: 10, credit: 0.5 },
  },
}

const subAgent = {
  type: 'function_call',
  sessionId: 's2',
  cwd: 'd:\\w\\p',
  timestamp: 4000,
  providerData: {
    messageId: 'a1',
    model: 'hy3',
    isSubAgent: true,
    usage: { requests: 1, inputTokens: 20, outputTokens: 0, totalTokens: 20, inputTokensDetails: [{ cached_tokens: 0 }] },
    rawUsage: { credit: 0.2, prompt_cache_miss_tokens: 20 },
  },
}

function lazy(path: string[], text: string): LazyFile {
  return { path, read: async () => text }
}

async function parseDemo() {
  return parseWorkbuddy(
    [
      lazy(['.workbuddy', 'projects', 'p1', 's1.jsonl'], [line(m1), line(m1retry), line(zeroUsage), line({ type: 'ai-title', sessionId: 's1', title: '登录页改造' }), 'not-json'].join('\n')),
      lazy(['.workbuddy', 'projects', 'p1', 's1', 'subagents', 'agent-a.jsonl'], line(subAgent)),
    ],
    { sources: { historyRoots: [], scannedAt: '2026-10-29T00:00:00.000Z' } },
  )
}

describe('parseWorkbuddy', () => {
  it('按 (sessionId,messageId) 去重，保留时间更大的那条', async () => {
    const ds = await parseDemo()
    expect(ds.selfCheck.requestsTotal).toBe(4)
    expect(ds.selfCheck.requestsWithUsage).toBe(3)
    expect(ds.selfCheck.duplicateRequests).toBe(1)
    const s1 = ds.sessions.find((s) => s.rawId === 's1')!
    // 保留的是 120 那条，而不是先出现的 110
    expect(s1.requests[0].total).toBe(120)
  })

  it('usage 整组全零时整组回落 rawUsage', async () => {
    const ds = await parseDemo()
    expect(ds.selfCheck.usageZeroFallbacks).toBe(1)
    const s1 = ds.sessions.find((s) => s.rawId === 's1')!
    const zero = s1.requests.find((r) => r.total === 55)!
    expect(zero.input).toBe(50)
    expect(zero.output).toBe(5)
    expect(zero.cache).toBe(40)
    expect(zero.cacheMiss).toBe(10)
  })

  it('subagents 目录必须递归，且标成独立会话', async () => {
    const ds = await parseDemo()
    expect(ds.sessions).toHaveLength(2)
    expect(ds.selfCheck.subAgentSessions).toBe(1)
    const sub = ds.sessions.find((s) => s.rawId === 's2')!
    expect(sub.isSubAgent).toBe(true)
    expect(sub.id).toBe('workbuddy:s2')
  })

  it('请求级模型带 glm-5.2-x → glm-5.2 归一；标题取 ai-title', async () => {
    const ds = await parseDemo()
    const s1 = ds.sessions.find((s) => s.rawId === 's1')!
    expect(s1.requests[0].model).toBe('glm-5.2')
    expect(s1.title).toBe('登录页改造')
    expect(s1.modelId).toBe('glm-5.2')
  })

  it('恒等式自检与坏行计数', async () => {
    const ds = await parseDemo()
    expect(ds.selfCheck.totalEqInputPlusOutput.fail).toBe(0)
    expect(ds.selfCheck.inputEqCachePlusMiss.fail).toBe(0)
    expect(ds.selfCheck.parseErrors).toBe(1)
    expect(ds.selfCheck.requestsWithoutCredit).toBe(0)
  })

  it('积分按请求累加，覆盖率按 credit 字段是否存在统计', async () => {
    const ds = await parseDemo()
    const s1 = ds.sessions.find((s) => s.rawId === 's1')!
    expect(s1.totals.credit).toBeCloseTo(2.5)
    const noCredit = await parseWorkbuddy(
      [lazy(['.workbuddy', 'projects', 'p1', 'x.jsonl'], line({ ...m1, providerData: { ...m1.providerData, messageId: 'm9', rawUsage: { prompt_cache_miss_tokens: 20 } } }))],
      { sources: { historyRoots: [], scannedAt: '' } },
    )
    expect(noCredit.selfCheck.requestsWithoutCredit).toBe(1)
    expect(noCredit.sessions[0].requests[0].creditKnown).toBe(false)
  })

  it('源信息按 projects 归集，不把 .workbuddy 的其它目录带进来', async () => {
    const ds = await parseDemo()
    expect(ds.sources.projectCount).toBe(1)
    expect(ds.sources.convIndexCount).toBe(2)
    expect(ds.sources.historyRoots).toEqual(['.workbuddy/projects'])
    expect(ds.bySource.workbuddy).toBeTruthy()
  })
})
