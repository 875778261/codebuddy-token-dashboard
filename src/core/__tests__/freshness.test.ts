import { describe, expect, it } from 'vitest'
import { deriveFreshness, describeWhen } from '../freshness'
import { emptySelfCheck } from '../parse'
import type { Dataset, SourceId } from '../types'

const DAY = '2026-10-29T18:20:00.000Z'

function slice(source: SourceId, scannedAt: string, mergedAt = '2026-10-30T12:00:00.000Z'): Dataset {
  const info = { historyRoots: [`${source}/history`], projectCount: 1, convIndexCount: 1, sessionMetaCount: 0, scannedAt, elapsedMs: 12 }
  return {
    schemaVersion: 2,
    generatedAt: mergedAt,
    sources: { ...info, scannedAt: mergedAt },
    bySource: { [source]: { info, selfCheck: emptySelfCheck(), coverage: { daysWithData: 1, daysInRange: 1, missingDays: [] } } },
    sessions: [],
    selfCheck: emptySelfCheck(),
    coverage: { daysWithData: 1, daysInRange: 1, missingDays: [] },
  }
}

describe('deriveFreshness', () => {
  it('两端在同一轮里扫到：都算本次刷新', () => {
    const slices = { codebuddy: slice('codebuddy', DAY), workbuddy: slice('workbuddy', DAY) }
    const f = deriveFreshness(slices, { codebuddy: 1000, workbuddy: 1000 })
    expect(f.codebuddy).toEqual({ at: DAY, fresh: true })
    expect(f.workbuddy).toEqual({ at: DAY, fresh: true })
  })

  it('只重扫一端：另一端记为缓存，并保留自己的扫描时间', () => {
    const wbAt = '2026-10-24T08:05:00.000Z'
    const slices = { codebuddy: slice('codebuddy', DAY), workbuddy: slice('workbuddy', wbAt) }
    const f = deriveFreshness(slices, { codebuddy: 2000, workbuddy: 1000 })
    expect(f.codebuddy?.fresh).toBe(true)
    expect(f.workbuddy).toEqual({ at: wbAt, fresh: false })
  })

  it('从 IndexedDB 恢复（本会话没扫过任何一端）：两端都是缓存', () => {
    const slices = { codebuddy: slice('codebuddy', DAY), workbuddy: slice('workbuddy', DAY) }
    const f = deriveFreshness(slices, {})
    expect(f.codebuddy?.fresh).toBe(false)
    expect(f.workbuddy?.fresh).toBe(false)
  })

  it('没载入的源不产出条目', () => {
    const f = deriveFreshness({ workbuddy: slice('workbuddy', DAY) }, { workbuddy: 1, codebuddy: 1 })
    expect(Object.keys(f)).toEqual(['workbuddy'])
  })

  it('扫描时间取逐源 bySource，不取合并后取最大值的 sources.scannedAt', () => {
    const wbAt = '2026-10-24T08:05:00.000Z'
    // 合并层把 sources.scannedAt 取成两源最大值，这里刻意设置成比 WB 新
    const slices = { workbuddy: slice('workbuddy', wbAt, '2026-10-30T12:00:00.000Z') }
    expect(deriveFreshness(slices, { workbuddy: 1 }).workbuddy?.at).toBe(wbAt)
  })
})

describe('describeWhen', () => {
  // 一律用本机时区构造，避免测试结果随 CI 时区漂移
  const now = new Date(2026, 9, 30, 12, 0, 0).getTime()
  const at = (...args: [number, number, number, number, number]) => new Date(...args).toISOString()

  it('一分钟内算刚刚', () => {
    expect(describeWhen(new Date(now - 10_000).toISOString(), now)).toBe('刚刚')
  })

  it('未来几秒的时钟漂移也算刚刚，不出现负数', () => {
    expect(describeWhen(new Date(now + 8_000).toISOString(), now)).toBe('刚刚')
  })

  it('一小时以内给分钟数', () => {
    expect(describeWhen(new Date(now - 25 * 60_000).toISOString(), now)).toBe('25 分钟前')
  })

  it('今天更早的时间给「今天 HH:mm」', () => {
    expect(describeWhen(at(2026, 9, 30, 9, 31), now)).toBe('今天 09:31')
  })

  it('昨天给「昨天 HH:mm」', () => {
    expect(describeWhen(at(2026, 9, 29, 18, 20), now)).toBe('昨天 18:20')
  })

  it('2~6 天前给天数', () => {
    expect(describeWhen(at(2026, 9, 27, 8, 5), now)).toBe('3 天前')
  })

  it('更早的同一年给「MM-DD HH:mm」', () => {
    expect(describeWhen(at(2026, 8, 1, 7, 5), now)).toBe('09-01 07:05')
  })

  it('跨年带年份', () => {
    expect(describeWhen(at(2025, 11, 31, 23, 5), now)).toBe('2025-12-31 23:05')
  })

  it('解析不了的时间明说不知道', () => {
    expect(describeWhen('', now)).toBe('时间未知')
    expect(describeWhen('not-a-date', now)).toBe('时间未知')
  })
})
