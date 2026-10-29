import type { SessionRecord, SourceId } from './types'

/** 会话 id 一律带源前缀：两源都是裸 UUID，不加前缀会被静默合并 */
export function qualify(source: SourceId, rawId: string): string {
  const prefix = `${source}:`
  return rawId.startsWith(prefix) ? rawId : `${prefix}${rawId}`
}

/** 取回源内原始 id；老快照（无 rawId）从带前缀的 id 里剥 */
export function rawIdOf(session: Pick<SessionRecord, 'id' | 'rawId' | 'source'>): string {
  if (session.rawId) return session.rawId
  const prefix = `${session.source}:`
  return session.id.startsWith(prefix) ? session.id.slice(prefix.length) : session.id
}
