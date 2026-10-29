import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { readKeyValueTable, SqliteReader } from '../sqlite'
import { parseSessionsDb } from '../sessions'

/**
 * 手写 SQLite 解析器必须有外部基准：这里直接拿本机真实的 vscdb 做对拍。
 * 文件不存在（CI / 他人机器）时跳过，而不是伪造一个"通过"。
 */
const DB = path.join(process.env.APPDATA ?? '', 'CodeBuddy CN', 'codebuddy-sessions.vscdb')
const hasDb = existsSync(DB)

describe('最小 SQLite 解析器', () => {
  it('识别非 SQLite 文件', () => {
    expect(() => new SqliteReader(new TextEncoder().encode('hello world 123456789'))).toThrow(/SQLite/)
  })

  it.skipIf(!hasDb)('读出 ItemTable 的 session: 行，并与 JSON 结构对齐', () => {
    const bytes = new Uint8Array(readFileSync(DB))
    const rows = readKeyValueTable(bytes, 'ItemTable')
    expect(rows.length).toBeGreaterThan(10)
    const sessionRows = rows.filter(([k]) => k.startsWith('session:'))
    expect(sessionRows.length).toBeGreaterThan(10)
    const metas = parseSessionsDb(bytes)
    expect(metas.length).toBe(sessionRows.length)
    expect(metas[0].conversationId).toBeTruthy()
    expect(metas.filter((m) => m.cwd).length / metas.length).toBeGreaterThan(0.8)
    for (const m of metas) {
      expect(m.conversationId.length).toBeGreaterThan(8)
      expect(typeof m.title === 'string' || m.title === undefined).toBe(true)
    }
  })
})
