import { describe, expect, it } from 'vitest'
import { isCliLogPath, isCliTracePath, mergeCliArchive, parseCli } from '../cliParse'
import type { LazyFile } from '../parse'

const HEAD = 'Workspace Path: d:\\lhl_code\\野心测试\\case1'

const call = (o: {
  ts: string
  sid: string
  rid: string
  eventId: string
  input: number
  output: number
  cache?: number
  write?: number
  model?: string
}) =>
  `[2026/11/20 ${o.ts}] [Info] [pid=14912] [ModelProvider]  ${JSON.stringify({
    model: o.model ?? 'deepseek-v4.1-flash',
    step: 1,
    attempt_no: 1,
    time_to_first_token_ms: 2290,
    input_tokens: o.input,
    output_tokens: o.output,
    total_tokens: o.input + o.output,
    cached_read_tokens: o.cache ?? 0,
    cached_write_tokens: o.write ?? 0,
    finish_reason: 'stop',
    event_id: o.eventId,
    event_name: 'agent.model_call.completed',
    service: 'agent-cli',
    duration_ms: 2803,
    conversation_id: o.sid,
    conversation_request_id: o.rid,
    conversation_message_id: `${o.eventId}-msg`,
    trace_id: 'trace-1',
  })}`

const credit = (ts: string, rid: string, value: number, source = 'raw_model_stream_event') =>
  `[2026/11/20 ${ts}] [Info] [pid=14912] [SessionManager][credit] Credit received: rootRequestId=${rid}, source=${source}, credit=${value}`

const lazy = (path: string[], text: string): LazyFile => ({ path, read: async () => text })

const LOG_PATH = ['codebuddy', 'logs', '2026-11-20', 'case1__8b0dd2d8.log']

// 一个 turn 两次调用：积分只有顺序，没有 messageId，必须按组内顺序配对
const logText = [
  HEAD,
  call({ ts: '12:01:05.475', sid: 's1', rid: 'r1', eventId: 'e1', input: 1000, output: 100, cache: 800 }),
  credit('12:01:05.455', 'r1', 0.75),
  credit('12:01:05.473', 'r1', 0.75, 'response_done'),
  call({ ts: '12:01:08.100', sid: 's1', rid: 'r1', eventId: 'e2', input: 1200, output: 40, cache: 900 }),
  credit('12:01:08.090', 'r1', 0.03),
  credit('12:01:08.099', 'r1', 0.03, 'response_done'),
  // 第二个会话：没有 credit 行（例如被截断）
  call({ ts: '12:02:00.000', sid: 's2', rid: 'r2', eventId: 'e3', input: 500, output: 20 }),
].join('\n')

const traceText = [
  JSON.stringify({
    type: 'trace_start',
    trace: { agent: { kind: 'auxiliary', name: 'conversation_topic', sessionId: 's2', parentSessionId: 's1' } },
  }),
].join('\n')

const opts = { sources: { historyRoots: ['codebuddy/logs'], scannedAt: '2026-11-20T05:00:00.000Z' } }

describe('cliParse', () => {
  it('识别日志与 traces 的文件形状', () => {
    expect(isCliLogPath(LOG_PATH)).toBe(true)
    expect(isCliLogPath(['workbuddy', 'logs', 'main.log'])).toBe(true)
    expect(isCliLogPath(['codebuddy', 'projects', 'a.jsonl'])).toBe(false)
    expect(isCliTracePath(['codebuddy', 'traces', '21728', 'trace_abc.jsonl'])).toBe(true)
    expect(isCliTracePath(['codebuddy', 'traces', '21728', 'other.jsonl'])).toBe(false)
  })

  it('一次 model call = 一次请求，token 三段对齐', async () => {
    const ds = await parseCli([lazy(LOG_PATH, logText)], [], opts)
    expect(ds.sessions).toHaveLength(2)
    expect(ds.selfCheck.requestsWithUsage).toBe(3)
    expect(ds.selfCheck.requestsTotal).toBe(3)
    expect(ds.selfCheck.totalEqInputPlusOutput.fail).toBe(0)
    expect(ds.selfCheck.inputEqCachePlusMiss.fail).toBe(0)
    const s1 = ds.sessions.find((s) => s.rawId === 's1')!
    expect(s1.totals.requests).toBe(2)
    expect(s1.totals.total).toBe(1100 + 1240)
    expect(s1.totals.cache).toBe(800 + 900)
    expect(s1.totals.cacheMiss).toBe(200 + 300)
    expect(s1.cwd).toBe('d:\\lhl_code\\野心测试\\case1')
    expect(s1.source).toBe('codebuddy-cli')
  })

  it('积分按 rootRequestId 组内顺序配对，且不因两个 source 翻倍', async () => {
    const ds = await parseCli([lazy(LOG_PATH, logText)], [], opts)
    const s1 = ds.sessions.find((s) => s.rawId === 's1')!
    const byKey = new Map(s1.requests.map((r) => [r.key, r]))
    expect(byKey.get('e1')!.credit).toBe(0.75)
    expect(byKey.get('e2')!.credit).toBe(0.03)
    expect(s1.totals.credit).toBeCloseTo(0.78, 6)
    // s2 没有 credit：记 0，但必须标成「没有积分字段」而不是「积分是 0」
    const s2 = ds.sessions.find((s) => s.rawId === 's2')!
    expect(s2.requests[0].creditKnown).toBe(false)
    expect(ds.selfCheck.requestsWithoutCredit).toBe(1)
  })

  it('辅助 agent 按 traces 打子会话标，与主会话分开', async () => {
    const ds = await parseCli([lazy(LOG_PATH, logText)], [lazy(['codebuddy', 'traces', '14912', 'trace_1.jsonl'], traceText)], opts)
    const s2 = ds.sessions.find((s) => s.rawId === 's2')!
    const s1 = ds.sessions.find((s) => s.rawId === 's1')!
    expect(s2.isSubAgent).toBe(true)
    expect(s1.isSubAgent).toBe(false)
    expect(ds.selfCheck.subAgentSessions).toBe(1)
  })

  it('同一条 model call 被重复枚举时只算一次', async () => {
    const ds = await parseCli([lazy(LOG_PATH, logText), lazy(LOG_PATH, logText)], [], opts)
    expect(ds.selfCheck.requestsWithUsage).toBe(3)
    expect(ds.selfCheck.duplicateRequests).toBe(3)
  })

  it('归档合并：日志轮转后旧的请求仍在，且按 key 去重', async () => {
    const first = await parseCli([lazy(LOG_PATH, logText)], [], opts)
    // 第二轮日志只剩 s1 的第一次调用
    const shrunk = [HEAD, call({ ts: '12:01:05.475', sid: 's1', rid: 'r1', eventId: 'e1', input: 1000, output: 100, cache: 800 })].join('\n')
    const second = await parseCli([lazy(LOG_PATH, shrunk)], [], { ...opts, archived: first })
    expect(second.selfCheck.requestsWithUsage).toBe(3)
    expect(second.selfCheck.archiveRequests).toBe(2)
    expect(second.sessions.find((s) => s.rawId === 's2')).toBeTruthy()
    const s1 = second.sessions.find((s) => s.rawId === 's1')!
    expect(s1.requests.map((r) => r.key)).toEqual(['e1', 'e2'])
    // 归档里已经配好的积分不会因为重扫丢掉
    expect(s1.requests.find((r) => r.key === 'e2')!.credit).toBe(0.03)
  })

  it('归档只接受 CLI 自己的会话', async () => {
    const ds = await parseCli([lazy(LOG_PATH, logText)], [], opts)
    const foreign = { ...ds, sessions: ds.sessions.map((s) => ({ ...s, source: 'workbuddy' as const })) }
    const merged = mergeCliArchive(ds, foreign)
    expect(merged.sessions).toHaveLength(2)
    expect(merged.selfCheck.archiveRequests).toBe(0)
  })

  it('全角缺少 usage 的日志不算请求', async () => {
    const noise = ['Workspace Path: c:\\Users\\HUAWEI', '[2026/11/20 11:50:26.006] [Info] [ShellService] warmup'].join('\n')
    const ds = await parseCli([lazy(LOG_PATH, noise)], [], opts)
    expect(ds.sessions).toHaveLength(0)
    expect(ds.selfCheck.requestsWithUsage).toBe(0)
  })
})
