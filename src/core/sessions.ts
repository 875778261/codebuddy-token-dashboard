import { readKeyValueTable } from './sqlite'
import type { SessionMeta } from './types'

/**
 * codebuddy-sessions.vscdb → 会话维表。
 * 这是本地唯一同时给出「会话标题 + 项目绝对路径 + 完成状态」的来源。
 * 读不出来时不要报错阻塞主流程：history 自身已能支撑除 cwd 外的全部指标。
 */
export function parseSessionsDb(bytes: Uint8Array): SessionMeta[] {
  const rows = readKeyValueTable(bytes, 'ItemTable')
  const out: SessionMeta[] = []
  for (const [key, value] of rows) {
    if (!key.startsWith('session:') || !value) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(value)
    } catch {
      continue
    }
    if (!parsed || typeof parsed !== 'object') continue
    const raw = parsed as Record<string, unknown>
    const conversationId = String(raw.conversationId ?? key.slice('session:'.length))
    if (!conversationId) continue
    out.push({
      conversationId,
      cwd: typeof raw.cwd === 'string' ? raw.cwd : undefined,
      userId: typeof raw.userId === 'string' ? raw.userId : undefined,
      title: typeof raw.title === 'string' ? raw.title : undefined,
      status: typeof raw.status === 'string' ? raw.status : undefined,
      createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : undefined,
      updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : undefined,
      isPlayground: typeof raw.isPlayground === 'boolean' ? raw.isPlayground : undefined,
    })
  }
  return out
}
