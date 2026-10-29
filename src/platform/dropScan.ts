import type { ScannedFile } from '../core/parse'
import { parseSessionsDb } from '../core/sessions'
import type { SessionMeta } from '../core/types'

/**
 * 拖拽通道：浏览器对 AppData 这类系统目录会拒绝弹选择器（"文件夹包含系统文件"），
 * 但把文件夹拖进窗口不受此限制——拖进来的是 FileSystemEntry，同样只在本地读。
 *
 * 注意：`file://` 下浏览器不会为拖入的目录创建条目，表现为"拖了没反应"；
 * 所以页面必须通过 http(s) 提供（`npm run dev` 或静态托管）。
 */

const SESSIONS_DB = 'codebuddy-sessions.vscdb'
const MAX_DEPTH = 16
const MAX_INDEX_FILES = 4000
const READ_CONCURRENCY = 8

const SKIP_DIRS = new Set([
  'node_modules',
  'CachedData',
  'CachedProfilesData',
  'Cache',
  'Code Cache',
  'GPUCache',
  'ShaderCache',
  'GrShaderCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'logs',
  'Crashpad',
  'CrashReport',
  'Session Storage',
  'Local Storage',
  'Service Worker',
  'blob_storage',
  'Backups',
  'Partitions',
  'media',
  'media-index',
  'messages',
  'brain',
  'todos',
  'file-changes',
  'edit-sessions',
  'genie-history',
])

interface EntryLike {
  isFile: boolean
  isDirectory: boolean
  name: string
  file?(ok: (f: File) => void, err?: (e: unknown) => void): void
  createReader?(): { readEntries(ok: (entries: EntryLike[]) => void, err?: (e: unknown) => void): void }
}

export interface DropResult {
  files: ScannedFile[]
  sessionMeta: SessionMeta[]
  sessionsDbName?: string
  /** 拖进来的 .json（快照）文件，交给上层决定是否导入 */
  jsonFiles: File[]
  /** 拖进来的名字，用于提示 */
  roots: string[]
  /** 命中的 history 根（相对拖入根），供"数据体检"展示 */
  historyRoots: string[]
  elapsedMs: number
}

const readEntries = (reader: { readEntries(ok: (e: EntryLike[]) => void, err?: (e: unknown) => void): void }) =>
  new Promise<EntryLike[]>((resolve) => {
    const all: EntryLike[] = []
    const next = () =>
      reader.readEntries((batch) => {
        // Chrome 单次最多返回 100 条，必须读到空数组为止
        if (!batch.length) return resolve(all)
        all.push(...batch)
        next()
      }, () => resolve(all))
    next()
  })

const fileOf = (entry: EntryLike) =>
  new Promise<File | null>((resolve) => {
    if (!entry.file) return resolve(null)
    entry.file(
      (f) => resolve(f),
      () => resolve(null),
    )
  })

const isHistoryIndex = (path: string[]) => path[path.length - 1] === 'index.json' && path.slice(0, -1).includes('history')

export function dropSupported(): boolean {
  return typeof DataTransferItem !== 'undefined' && 'webkitGetAsEntry' in DataTransferItem.prototype
}

/**
 * 拖拽时顺手捞一个可持久化的目录句柄（Chromium 的 getAsFileSystemHandle）。
 * 拿到句柄后「重扫 / 自动刷新」才可用；拿不到也不影响本次读取，所以给个超时兜底。
 * 必须在 drop 事件的同步阶段调用，事件结束后 items 会失效。
 */
export function captureHandles(dt: DataTransfer): Array<Promise<FileSystemHandle | null>> {
  const out: Array<Promise<FileSystemHandle | null>> = []
  for (const item of Array.from(dt.items ?? [])) {
    const get = (item as DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> })
      .getAsFileSystemHandle
    if (typeof get !== 'function') continue
    try {
      out.push(Promise.resolve(get.call(item)).catch(() => null))
    } catch {
      /* 忽略：拿不到就算了 */
    }
  }
  return out
}

export async function firstDirectoryHandle(
  promises: Array<Promise<FileSystemHandle | null>>,
  timeoutMs = 2000,
): Promise<FileSystemDirectoryHandle | null> {
  if (!promises.length) return null
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))
  const settled = await Promise.race([Promise.all(promises), timeout])
  if (!Array.isArray(settled)) return null
  return (settled.find((h) => h && h.kind === 'directory') as FileSystemDirectoryHandle | undefined) ?? null
}

export async function scanDrop(
  dt: DataTransfer,
  onProgress?: (stage: string, done: number, total?: number) => void,
): Promise<DropResult> {
  const started = performance.now()
  const roots: EntryLike[] = []
  const jsonFiles: File[] = []
  const historyRoots = new Set<string>()
  const pending: Array<{ path: string[]; file: File }> = []
  let dbFile: File | null = null
  let sessionsDbName: string | undefined
  let visited = 0

  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind !== 'file') continue
    const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => EntryLike | null }).webkitGetAsEntry?.()
    if (entry) {
      roots.push(entry)
      continue
    }
    const file = item.getAsFile()
    if (file) {
      if (/\.json$/i.test(file.name)) jsonFiles.push(file)
      else roots.push({ isFile: true, isDirectory: false, name: file.name })
    }
  }

  // 有些环境拿不到 entry（例如跨源拖拽），退回 files 列表
  if (!roots.length && dt.files?.length) {
    for (const file of Array.from(dt.files)) {
      if (/\.json$/i.test(file.name)) jsonFiles.push(file)
      else roots.push({ isFile: true, isDirectory: false, name: file.name })
    }
  }

  async function walk(entry: EntryLike, path: string[], depth: number) {
    if (depth > MAX_DEPTH || pending.length >= MAX_INDEX_FILES) return
    if (entry.isFile) {
      if (isHistoryIndex(path)) {
        const file = await fileOf(entry)
        if (file) pending.push({ path, file })
        historyRoots.add(path.slice(0, path.indexOf('history')).join('/') || '.')
        return
      }
      if (entry.name === SESSIONS_DB && !dbFile) {
        dbFile = await fileOf(entry)
        sessionsDbName = entry.name
        return
      }
      if (/\.json$/i.test(entry.name)) {
        const file = await fileOf(entry)
        if (file) jsonFiles.push(file)
      }
      return
    }
    if (!entry.createReader) return
    const children = await readEntries(entry.createReader())
    for (const child of children) {
      if (child.isDirectory) {
        if (SKIP_DIRS.has(child.name) || child.name.startsWith('.')) continue
        await walk(child, [...path, child.name], depth + 1)
        continue
      }
      visited += 1
      if (visited % 200 === 0) onProgress?.('正在遍历拖入的目录…', visited)
      const childPath = [...path, child.name]
      if (child.name === SESSIONS_DB && !dbFile) {
        dbFile = await fileOf(child)
        sessionsDbName = child.name
        continue
      }
      if (!isHistoryIndex(childPath)) continue
      const file = await fileOf(child)
      if (file) {
        pending.push({ path: childPath, file })
        historyRoots.add(childPath.slice(0, childPath.indexOf('history')).join('/') || '.')
      }
    }
  }

  for (const root of roots) await walk(root, [root.name], 0)

  // 索引文件铺开读，8 路并发；顺序读 220 个大 JSON 会拖到 4s+
  const files: ScannedFile[] = new Array(pending.length)
  let cursor = 0
  let done = 0
  const workers = Array.from({ length: Math.min(READ_CONCURRENCY, pending.length || 1) }, async () => {
    while (cursor < pending.length) {
      const idx = cursor++
      const item = pending[idx]
      try {
        files[idx] = { path: item.path, text: await item.file.text() }
      } catch {
        files[idx] = { path: item.path, text: '' }
      }
      done += 1
      if (done % 20 === 0) onProgress?.('正在读取会话索引…', done, pending.length)
    }
  })
  await Promise.all(workers)

  let sessionMeta: SessionMeta[] = []
  if (dbFile) {
    try {
      sessionMeta = parseSessionsDb(new Uint8Array(await (dbFile as File).arrayBuffer()))
    } catch {
      sessionMeta = []
    }
  }

  onProgress?.('读取完成', files.length, files.length)
  return {
    files,
    sessionMeta,
    sessionsDbName,
    jsonFiles,
    roots: roots.map((r) => r.name),
    historyRoots: [...historyRoots],
    elapsedMs: Math.round(performance.now() - started),
  }
}
