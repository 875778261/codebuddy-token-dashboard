import { describe, expect, it } from 'vitest'
import { endGaps, promptingSources, sourceStates } from '../completeness'
import type { Dataset, SourceId } from '../types'

function ds(withData: Partial<Record<SourceId, number>>): Dataset {
  const bySource: Dataset['bySource'] = {}
  for (const [source, requests] of Object.entries(withData)) {
    bySource[source as SourceId] = {
      info: { historyRoots: [], projectCount: 0, convIndexCount: 0, sessionMetaCount: 0, scannedAt: '', elapsedMs: 0 },
      selfCheck: { requestsWithUsage: requests ?? 0 } as never,
      coverage: { daysWithData: 0, daysInRange: 0, missingDays: [] },
    }
  }
  return {
    schemaVersion: 3,
    generatedAt: '',
    sources: { historyRoots: [], projectCount: 0, convIndexCount: 0, sessionMetaCount: 0, scannedAt: '', elapsedMs: 0 },
    bySource,
    sessions: [],
    selfCheck: {} as never,
    coverage: { daysWithData: 0, daysInRange: 0, missingDays: [] },
  }
}

describe('completeness', () => {
  it('有数据才算已读入；有切片但 0 条仍算未读入', () => {
    const states = sourceStates(ds({ codebuddy: 12, 'codebuddy-cli': 0 }), [])
    expect(states.find((s) => s.source === 'codebuddy')!.loaded).toBe(true)
    expect(states.find((s) => s.source === 'codebuddy-cli')!.loaded).toBe(false)
    expect(promptingSources(states)).toEqual(['codebuddy-cli', 'workbuddy'])
  })

  it('标记过「我没有」的源不再提示', () => {
    const states = sourceStates(ds({ 'codebuddy-cli': 284 }), ['codebuddy'])
    expect(promptingSources(states)).toEqual(['workbuddy'])
  })

  it('端能比但端内缺源：两级分别给结论', () => {
    const gaps = endGaps(sourceStates(ds({ 'codebuddy-cli': 284, workbuddy: 30 }), []))
    const cb = gaps.find((g) => g.end === 'codebuddy')!
    expect(cb.loaded).toEqual(['codebuddy-cli'])
    expect(cb.missing).toEqual(['codebuddy'])
    const wb = gaps.find((g) => g.end === 'workbuddy')!
    expect(wb.missing).toEqual([])
  })

  it('整端缺席时也报端内源，不因为端为空就静默', () => {
    const gaps = endGaps(sourceStates(ds({ codebuddy: 5 }), []))
    const wb = gaps.find((g) => g.end === 'workbuddy')!
    expect(wb.loaded).toEqual([])
    expect(wb.missing).toEqual(['workbuddy'])
  })
})
