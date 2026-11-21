import { describe, expect, it } from 'vitest'
import { scanDrop } from '../dropScan'

/**
 * 拖入 `~/.codebuddy` 曾经读到 0 条：目录遍历里只有「入口即文件」的分支认 CLI 日志，
 * 由父目录枚举出来的 .log 会被静默丢掉。这组用例锁住三条入口都认。
 */

interface FakeEntry {
  isFile: boolean
  isDirectory: boolean
  name: string
  createReader?: () => { readEntries: (ok: (e: FakeEntry[]) => void) => void }
  file?: (ok: (f: File) => void, err?: () => void) => void
}

const fileEntry = (name: string, text: string): FakeEntry => ({
  isFile: true,
  isDirectory: false,
  name,
  file: (ok) => ok({ name, text: async () => text } as unknown as File),
})

const dirEntry = (name: string, children: FakeEntry[]): FakeEntry => ({
  isFile: false,
  isDirectory: true,
  name,
  createReader: () => {
    let served = false
    return {
      readEntries: (ok) => {
        // 浏览器语义：读到空数组才算结束
        if (served) return ok([])
        served = true
        ok(children)
      },
    }
  },
})

const dtOf = (roots: FakeEntry[]) =>
  ({ items: roots.map((entry) => ({ kind: 'file', webkitGetAsEntry: () => entry })), files: [] }) as unknown as DataTransfer

const HEAD = 'Workspace Path: d:\\lhl_code\\野心测试'
const call =
  '[2026/11/20 12:01:05.475] [Info] [pid=1] [ModelProvider]  {"model":"m","step":1,"attempt_no":1,"input_tokens":10,"output_tokens":2,"total_tokens":12,"cached_read_tokens":0,"cached_write_tokens":0,"event_id":"e1","event_name":"agent.model_call.completed","conversation_id":"s1","conversation_request_id":"r1"}'

describe('scanDrop', () => {
  it('拖入 ~/.codebuddy 时读到 logs 里的用量日志', async () => {
    const root = dirEntry('.codebuddy', [
      dirEntry('logs', [dirEntry('2026-11-20', [fileEntry('case1__abc.log', `${HEAD}\n${call}`)])]),
      dirEntry('traces', [dirEntry('14912', [fileEntry('trace_x.jsonl', '{}')])]),
    ])
    const res = await scanDrop(dtOf([root]))
    expect(res.cliLogs.map((f) => f.path.join('/'))).toEqual(['.codebuddy/logs/2026-11-20/case1__abc.log'])
    expect(res.cliTraces).toHaveLength(1)
    expect(res.historyRoots.codebuddyCli).toEqual(['.codebuddy/logs'])
    // 不能被误判成 WorkBuddy / CodeBuddy IDE
    expect(res.wbFiles).toHaveLength(0)
    expect(res.cbFiles).toHaveLength(0)
  })

  it('拖入 ~/.codebuddy 时不进 projects（空壳 jsonl 会被误认成 WorkBuddy）', async () => {
    const root = dirEntry('.codebuddy', [
      dirEntry('projects', [dirEntry('d-lhl_code-x', [fileEntry('s1.jsonl', '{"type":"message"}')])]),
      fileEntry('models.json', '{"models":[]}'),
      dirEntry('logs', [dirEntry('2026-11-20', [fileEntry('a.log', HEAD)])]),
    ])
    const res = await scanDrop(dtOf([root]))
    expect(res.wbFiles).toHaveLength(0)
    expect(res.jsonFiles).toHaveLength(0)
    expect(res.cliLogs).toHaveLength(1)
  })

  it('直接把 logs 文件夹拖进来也认', async () => {
    const root = dirEntry('logs', [dirEntry('2026-11-20', [fileEntry('a.log', HEAD)])])
    const res = await scanDrop(dtOf([root]))
    expect(res.cliLogs).toHaveLength(1)
    expect(res.historyRoots.codebuddyCli).toEqual(['logs'])
  })

  it('WorkBuddy 与 IDE 的形状仍然各自归位', async () => {
    const wb = dirEntry('.workbuddy', [
      dirEntry('projects', [dirEntry('p1', [fileEntry('s1.jsonl', '{}')])]),
    ])
    const cb = dirEntry('Data', [
      dirEntry('history', [dirEntry('h1', [dirEntry('c1', [fileEntry('index.json', '{}')])])]),
    ])
    const res = await scanDrop(dtOf([wb, cb]))
    expect(res.wbFiles).toHaveLength(1)
    expect(res.cbFiles).toHaveLength(1)
    expect(res.cliLogs).toHaveLength(0)
  })
})
