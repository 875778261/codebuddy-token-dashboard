import { describe, expect, it } from 'vitest'
import { buildDemoDataset } from '../demo'
import { parseSnapshot, serializeDataset, snapshotFileName } from '../snapshot'

describe('快照往返', () => {
  const demo = buildDemoDataset(new Date('2026-10-29T12:00:00').getTime())
  const text = serializeDataset(demo)
  const back = parseSnapshot(text)

  it('会话数、请求级明细与总量完全一致', () => {
    expect(back.sessions.length).toBe(demo.sessions.length)
    expect(back.sessions.reduce((a, s) => a + s.totals.total, 0)).toBe(demo.sessions.reduce((a, s) => a + s.totals.total, 0))
    expect(back.sessions.reduce((a, s) => a + s.requests.length, 0)).toBe(demo.sessions.reduce((a, s) => a + s.requests.length, 0))
  })

  it('重新计算 totals 而不是信任文件里的冗余字段', () => {
    const first = back.sessions[0]
    expect(first.totals.total).toBe(first.requests.reduce((a, r) => a + r.total, 0))
    expect(first.totals.firstTs).toBe(first.requests[0].ts)
  })

  it('拒绝非快照文件', () => {
    expect(() => parseSnapshot('{"a":1}')).toThrow(/快照/)
    expect(() => parseSnapshot('not json')).toThrow(/JSON/)
  })

  it('文件名带日期，便于归档', () => {
    expect(snapshotFileName(new Date('2026-10-29T08:05:00'))).toBe('codebuddy-usage-20261029-0805.json')
  })
})
