/**
 * Node 侧读取本机 CodeBuddy 数据，供 `npm run collect` 与 `npm run verify` 共用。
 * 与浏览器端 `src/platform/browserScan.ts` 的过滤规则保持一致（同名跳过、只认 history 下的 index.json）。
 */
import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { ScannedFile } from '../src/core/parse'
import { parseSessionsDb } from '../src/core/sessions'
import type { SessionMeta } from '../src/core/types'

const SKIP_DIRS = new Set([
  'node_modules',
  'messages',
  'media',
  'media-index',
  'genie-history',
  'edit-sessions',
  'file-changes',
  'todos',
  'brain',
  'CachedData',
  'CachedProfilesData',
  'logs',
  'GPUCache',
  'Local Storage',
  'Session Storage',
  'Cache',
  'Code Cache',
  'Crashpad',
  'blob_storage',
  'Partitions',
  'Backups',
  'Service Worker',
])

const SESSIONS_DB = 'codebuddy-sessions.vscdb'
const MAX_DEPTH = 16

export interface LocalData {
  files: ScannedFile[]
  sessionMeta: SessionMeta[]
  /** 命中的 history 根（相对路径） */
  roots: string[]
  dbPath?: string
  elapsedMs: number
}

export function defaultPaths(): { root: string; dbPath: string } {
  const local = process.env.LOCALAPPDATA ?? path.join(process.env.HOME ?? '', 'Library/Application Support')
  const roaming = process.env.APPDATA ?? path.join(process.env.HOME ?? '', 'Library/Application Support')
  return {
    root: process.env.CB_DATA ?? path.join(local, 'CodeBuddyExtension', 'Data'),
    dbPath: process.env.CB_SESSIONS_DB ?? path.join(roaming, 'CodeBuddy CN', SESSIONS_DB),
  }
}

export async function readLocalData(root: string, dbPath?: string): Promise<LocalData> {
  const started = performance.now()
  const files: ScannedFile[] = []
  const roots = new Set<string>()
  let foundDb: string | undefined

  async function walk(dir: string, segments: string[], depth: number) {
    if (depth > MAX_DEPTH) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const next = [...segments, entry.name]
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
        await walk(path.join(dir, entry.name), next, depth + 1)
        continue
      }
      if (entry.name === SESSIONS_DB && !foundDb) foundDb = path.join(dir, entry.name)
      if (entry.name !== 'index.json') continue
      if (!segments.includes('history')) continue
      roots.add(segments.slice(0, segments.indexOf('history')).join('/') || '.')
      try {
        files.push({ path: next, text: await readFile(path.join(dir, entry.name), 'utf8') })
      } catch {
        files.push({ path: next, text: '' })
      }
    }
  }

  if (!existsSync(root)) throw new Error(`数据根不存在：${root}`)
  await walk(root, [], 0)

  let sessionMeta: SessionMeta[] = []
  const useDb = foundDb ?? dbPath
  if (useDb && existsSync(useDb)) {
    try {
      sessionMeta = parseSessionsDb(new Uint8Array(await readFile(useDb)))
    } catch (err) {
      console.warn(`读取会话库失败（${useDb}）：${(err as Error).message}`)
    }
  }

  return {
    files,
    sessionMeta,
    roots: [...roots],
    dbPath: useDb && existsSync(useDb) ? useDb : undefined,
    elapsedMs: Math.round(performance.now() - started),
  }
}
