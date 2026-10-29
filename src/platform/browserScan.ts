import type { LazyFile, ScannedFile } from '../core/parse'
import { parseSessionsDb } from '../core/sessions'
import type { SessionMeta } from '../core/types'

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
  'CachedProfilesData',
  'logs',
  'GPUCache',
  'Local Storage',
  'Session Storage',
  'Cache',
  'Code Cache',
  'Crashpad',
])

const MAX_DEPTH = 9
const SESSIONS_DB = 'codebuddy-sessions.vscdb'
/** WorkBuddy 数据根：只有 projects/ 有用量，app/plugins/workspace 合计 900MB+，绝不能进 */
const WB_ROOT = '.workbuddy'

export interface ScanResult {
  /** CodeBuddy 索引文件（已读文本，体积小） */
  cbFiles: ScannedFile[]
  /** WorkBuddy jsonl（惰性读取，逐个解析后就丢弃） */
  wbFiles: LazyFile[]
  sessionMeta: SessionMeta[]
  sessionsDbName?: string
  roots: { codebuddy: string[]; workbuddy: string[] }
  scannedAt: string
  elapsedMs: number
}

interface WalkState {
  cbIndexes: Array<{ indexPath: string[]; handle: FileSystemFileHandle }>
  wbFiles: Array<{ path: string[]; handle: FileSystemFileHandle }>
  cbRoots: Set<string>
  wbRoots: Set<string>
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

function isWorkbuddyJsonl(path: string[]): boolean {
  const file = path[path.length - 1]
  if (!file?.endsWith('.jsonl')) return false
  return path.slice(0, -1).includes('projects')
}

function pushWorkbuddy(state: WalkState, path: string[], handle: FileSystemFileHandle) {
  const idx = path.lastIndexOf('projects')
  if (idx >= 0) state.wbRoots.add(path.slice(0, idx + 1).join('/') || 'projects')
  state.wbFiles.push({ path, handle })
}

async function walk(dir: DirHandleLike, path: string[], state: WalkState, depth: number, onProgress?: Progress) {
  if (depth > MAX_DEPTH) return
  for await (const [name, entry] of dir.entries()) {
    if (entry.kind === 'directory') {
      if (SKIP_DIRS.has(name) || name.startsWith('.') && name !== WB_ROOT) continue
      if (name === WB_ROOT) {
        // WorkBuddy 根：只认 projects，其余 900MB+ 一律不进
        await walkWorkbuddyRoot(entry as unknown as DirHandleLike, [...path, name], state, depth + 1, onProgress)
        continue
      }
      await walk(entry as unknown as DirHandleLike, [...path, name], state, depth + 1, onProgress)
      continue
    }
    state.visited += 1
    const filePath = [...path, name]
    if (name === SESSIONS_DB && !state.sessionsDb) {
      state.sessionsDb = entry as unknown as FileSystemFileHandle
    }
    if (isHistoryIndex(filePath)) {
      state.cbIndexes.push({ indexPath: filePath, handle: entry as unknown as FileSystemFileHandle })
      const idx = filePath.lastIndexOf('history')
      if (idx >= 0) state.cbRoots.add(filePath.slice(0, idx + 1).join('/'))
    }
    if (isWorkbuddyJsonl(filePath)) {
      pushWorkbuddy(state, filePath, entry as unknown as FileSystemFileHandle)
    }
    if (onProgress && state.visited % 400 === 0) {
      onProgress('正在枚举目录…', state.cbIndexes.length + state.wbFiles.length, undefined)
    }
  }
}

/** 只遍历 .workbuddy/projects（含 <sessionId>/subagents/），其它子目录直接跳过 */
async function walkWorkbuddyRoot(dir: DirHandleLike, path: string[], state: WalkState, depth: number, onProgress?: Progress) {
  if (depth > MAX_DEPTH + 2) return
  for await (const [name, entry] of dir.entries()) {
    if (entry.kind !== 'directory' || name !== 'projects') continue
    await walk(entry as unknown as DirHandleLike, [...path, name], state, depth + 1, onProgress)
    return
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
  const base: Record<string, unknown> = { id: 'ai-usage-data', mode: 'read' }
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

export function emptyScanResult(): ScanResult {
  return {
    cbFiles: [],
    wbFiles: [],
    sessionMeta: [],
    roots: { codebuddy: [], workbuddy: [] },
    scannedAt: new Date().toISOString(),
    elapsedMs: 0,
  }
}

export async function scanDirectoryHandle(root: FileSystemDirectoryHandle, onProgress?: Progress): Promise<ScanResult> {
  const started = performance.now()
  const state: WalkState = { cbIndexes: [], wbFiles: [], cbRoots: new Set(), wbRoots: new Set(), visited: 0 }
  // 带上根目录名：否则 buildDataset 推导出的 history 根只剩 "history"
  const rootName = (root as unknown as DirHandleLike).name
  if (rootName === WB_ROOT) {
    await walkWorkbuddyRoot(root as unknown as DirHandleLike, [rootName], state, 0, onProgress)
  } else {
    await walk(root as unknown as DirHandleLike, [rootName], state, 0, onProgress)
  }

  const cbFiles: ScannedFile[] = []
  for (let i = 0; i < state.cbIndexes.length; i++) {
    const item = state.cbIndexes[i]
    try {
      const file = await item.handle.getFile()
      cbFiles.push({ path: item.indexPath, text: await file.text() })
    } catch {
      cbFiles.push({ path: item.indexPath, text: '' })
    }
    if (onProgress && i % 20 === 0) onProgress('正在读取会话索引…', i + 1, state.cbIndexes.length)
  }

  const wbFiles: LazyFile[] = state.wbFiles.map((item) => ({
    path: item.path,
    read: async () => {
      const file = await item.handle.getFile()
      return file.text()
    },
  }))

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

  return {
    cbFiles,
    wbFiles,
    sessionMeta,
    sessionsDbName,
    roots: { codebuddy: [...state.cbRoots].sort(), workbuddy: [...state.wbRoots].sort() },
    scannedAt: new Date().toISOString(),
    elapsedMs: Math.round(performance.now() - started),
  }
}

/** `<input webkitdirectory>` 兜底路径：支持 file:// 打开或浏览器不支持目录选择器时 */
export async function scanFileList(list: FileList, onProgress?: Progress): Promise<ScanResult & { rootName: string }> {
  const started = performance.now()
  const cbFiles: ScannedFile[] = []
  const wbFiles: LazyFile[] = []
  const cbRoots = new Set<string>()
  const wbRoots = new Set<string>()
  let sessionsDbFile: File | undefined
  let rootName = ''

  for (const file of Array.from(list)) {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
    const segments = rel.split('/')
    if (!rootName) rootName = segments[0]
    if (file.name === SESSIONS_DB) {
      sessionsDbFile = file
      continue
    }
    if (isHistoryIndex(segments)) {
      const idx = segments.lastIndexOf('history')
      if (idx >= 0) cbRoots.add(segments.slice(0, idx + 1).join('/'))
      try {
        cbFiles.push({ path: segments, text: await file.text() })
      } catch {
        cbFiles.push({ path: segments, text: '' })
      }
      continue
    }
    if (isWorkbuddyJsonl(segments)) {
      const idx = segments.lastIndexOf('projects')
      if (idx >= 0) wbRoots.add(segments.slice(0, idx + 1).join('/') || 'projects')
      wbFiles.push({ path: segments, read: () => file.text() })
    }
  }
  if (onProgress) onProgress('正在读取会话索引…', cbFiles.length + wbFiles.length, cbFiles.length + wbFiles.length)

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
    cbFiles,
    wbFiles,
    sessionMeta,
    sessionsDbName,
    rootName,
    roots: { codebuddy: [...cbRoots].sort(), workbuddy: [...wbRoots].sort() },
    scannedAt: new Date().toISOString(),
    elapsedMs: Math.round(performance.now() - started),
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
