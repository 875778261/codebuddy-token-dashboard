import type { ScannedFile } from '../core/parse'
import { parseSessionsDb } from '../core/sessions'
import type { SessionMeta, SourceInfo } from '../core/types'

/** 用户大概率会选 Data 根，也可能直接选到 history 或某个账号目录，都允许。 */
const SKIP_DIRS = new Set([
  'messages',
  'media',
  'media-index',
  'genie-history',
  'edit-sessions',
  'file-changes',
  'todos',
  'brain',
  'node_modules',
  'CachedData',
  'logs',
  'GPUCache',
  'Local Storage',
  'Session Storage',
  'Cache',
  'Code Cache',
])

const MAX_DEPTH = 9
const SESSIONS_DB = 'codebuddy-sessions.vscdb'

export interface ScanResult {
  files: ScannedFile[]
  sessionMeta: SessionMeta[]
  sources: Omit<SourceInfo, 'projectCount' | 'convIndexCount' | 'sessionMetaCount'>
  /** 是否找到会话库（没有就只能靠标题缺失的项目 hash 分组） */
  sessionsDbFound: boolean
}

interface Collected {
  indexPath: string[]
  handle: FileSystemFileHandle
}

interface WalkState {
  indexes: Collected[]
  sessionsDb?: FileSystemFileHandle
  visited: number
}

type Progress = (stage: string, done: number, total?: number) => void

interface FsEntry {
  kind: 'file' | 'directory'
  name: string
}

interface DirHandleLike {
  kind: 'directory'
  name: string
  entries(): AsyncIterableIterator<[string, FsEntry]>
}

function isHistoryIndex(path: string[]): boolean {
  const file = path[path.length - 1]
  if (file !== 'index.json') return false
  return path.slice(0, -1).includes('history')
}

async function walk(dir: DirHandleLike, path: string[], state: WalkState, depth: number, onProgress?: Progress) {
  if (depth > MAX_DEPTH) return
  for await (const [name, entry] of dir.entries()) {
    if (entry.kind === 'directory') {
      if (SKIP_DIRS.has(name) || name.startsWith('.')) continue
      await walk(entry as unknown as DirHandleLike, [...path, name], state, depth + 1, onProgress)
      continue
    }
    state.visited += 1
    if (name === SESSIONS_DB && !state.sessionsDb) {
      state.sessionsDb = entry as unknown as FileSystemFileHandle
    }
    const filePath = [...path, name]
    if (isHistoryIndex(filePath)) {
      state.indexes.push({ indexPath: filePath, handle: entry as unknown as FileSystemFileHandle })
    }
    if (onProgress && state.visited % 400 === 0) {
      onProgress('正在枚举目录…', state.indexes.length, undefined)
    }
  }
}

export function supportsDirectoryPicker(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'
}

export async function pickDirectory(remembered?: FileSystemDirectoryHandle | null): Promise<FileSystemDirectoryHandle | null> {
  const picker = (window as unknown as {
    showDirectoryPicker?: (opts?: Record<string, unknown>) => Promise<FileSystemDirectoryHandle>
  }).showDirectoryPicker
  if (!picker) return null
  const base: Record<string, unknown> = { id: 'codebuddy-data', mode: 'read' }
  // startIn 只接受 handle 或已知目录名，浏览器会自己记住上次位置
  if (remembered) {
    try {
      const perm = await (remembered as unknown as { queryPermission?: (d: { mode: string }) => Promise<string> })
        .queryPermission?.({ mode: 'read' })
      if (perm === 'granted') base.startIn = remembered
    } catch {
      /* 忽略 */
    }
  }
  try {
    return await picker(base)
  } catch (err) {
    // 用户取消不算错误；受限环境（如 file://）抛 SecurityError，由调用方回落到 <input webkitdirectory>
    if ((err as DOMException)?.name === 'AbortError') return null
    throw err
  }
}

export async function ensurePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const h = handle as unknown as {
    queryPermission?: (d: { mode: string }) => Promise<string>
    requestPermission?: (d: { mode: string }) => Promise<string>
  }
  try {
    const state = (await h.queryPermission?.({ mode: 'read' })) ?? 'granted'
    if (state === 'granted') return true
    const asked = (await h.requestPermission?.({ mode: 'read' })) ?? 'denied'
    return asked === 'granted'
  } catch {
    return false
  }
}

export async function scanDirectoryHandle(
  root: FileSystemDirectoryHandle,
  onProgress?: Progress,
): Promise<ScanResult> {
  const started = performance.now()
  const state: WalkState = { indexes: [], visited: 0 }
  // 带上根目录名：否则 buildDataset 推导出的 history 根只剩 "history"，
  // 「数据体检」里的采集源会丢掉是哪一层目录扫出来的（拖拽通道本来就是这样）
  await walk(root as unknown as DirHandleLike, [root.name], state, 0, onProgress)

  const files: ScannedFile[] = []
  for (let i = 0; i < state.indexes.length; i++) {
    const item = state.indexes[i]
    try {
      const file = await item.handle.getFile()
      const text = await file.text()
      files.push({ path: item.indexPath, text })
    } catch {
      files.push({ path: item.indexPath, text: '' })
    }
    if (onProgress && i % 20 === 0) onProgress('正在读取会话索引…', i + 1, state.indexes.length)
  }

  let sessionMeta: SessionMeta[] = []
  let sessionsDbName: string | undefined
  if (state.sessionsDb) {
    try {
      const file = await state.sessionsDb.getFile()
      const buffer = new Uint8Array(await file.arrayBuffer())
      sessionMeta = parseSessionsDb(buffer)
      sessionsDbName = file.name
    } catch {
      sessionMeta = []
    }
  }

  const now = new Date().toISOString()
  return {
    files,
    sessionMeta,
    sessionsDbFound: Boolean(sessionsDbName),
    sources: {
      historyRoots: [],
      sessionsDb: sessionsDbName,
      scannedAt: now,
      elapsedMs: Math.round(performance.now() - started),
    },
  }
}

/** `<input webkitdirectory>` 兜底路径：支持 file:// 打开或浏览器不支持目录选择器时 */
export async function scanFileList(list: FileList, onProgress?: Progress): Promise<ScanResult & { rootName: string }> {
  const started = performance.now()
  const files: ScannedFile[] = []
  let sessionsDbFile: File | undefined
  let rootName = ''

  const all = Array.from(list)
  for (const file of all) {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
    const segments = rel.split('/')
    if (!rootName) rootName = segments[0]
    if (file.name === SESSIONS_DB) {
      sessionsDbFile = file
      continue
    }
    if (isHistoryIndex(segments)) {
      try {
        files.push({ path: segments, text: await file.text() })
      } catch {
        files.push({ path: segments, text: '' })
      }
    }
  }
  if (onProgress) onProgress('正在读取会话索引…', files.length, files.length)

  let sessionMeta: SessionMeta[] = []
  let sessionsDbName: string | undefined
  if (sessionsDbFile) {
    try {
      sessionMeta = parseSessionsDb(new Uint8Array(await sessionsDbFile.arrayBuffer()))
      sessionsDbName = sessionsDbFile.name
    } catch {
      sessionMeta = []
    }
  }

  return {
    files,
    sessionMeta,
    rootName,
    sessionsDbFound: Boolean(sessionsDbName),
    sources: {
      historyRoots: [],
      sessionsDb: sessionsDbName,
      scannedAt: new Date().toISOString(),
      elapsedMs: Math.round(performance.now() - started),
    },
  }
}

/** 单独补选 codebuddy-sessions.vscdb（当用户只选了 Data 根时） */
export async function pickSessionsDb(): Promise<{ sessionMeta: SessionMeta[]; name: string } | null> {
  const picker = (window as unknown as {
    showOpenFilePicker?: (opts?: Record<string, unknown>) => Promise<FileSystemFileHandle[]>
  }).showOpenFilePicker
  if (picker) {
    try {
      const [handle] = await picker({ id: 'cb-sessions', multiple: false, types: [{ description: 'CodeBuddy 会话库', accept: { 'application/octet-stream': ['.vscdb', '.db'] } }] })
      if (!handle) return null
      const file = await handle.getFile()
      return { sessionMeta: parseSessionsDb(new Uint8Array(await file.arrayBuffer())), name: file.name }
    } catch {
      return null
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.vscdb,.db'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return resolve(null)
      try {
        resolve({ sessionMeta: parseSessionsDb(new Uint8Array(await file.arrayBuffer())), name: file.name })
      } catch {
        resolve(null)
      }
    }
    input.click()
  })
}
