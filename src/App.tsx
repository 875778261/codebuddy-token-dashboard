import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { aggregatesBySource, makeCustomWindow, makeWindow, type WindowPreset } from './core/aggregate'
import { buildDemoDataset } from './core/demo'
import { fmtInt, fmtTokens } from './core/format'
import { applySessionMeta, buildDataset } from './core/parse'
import { mergeSlices, splitBySource } from './core/merge'
import { parseWorkbuddy } from './core/workbuddyParse'
import { parseSnapshot, serializeDataset, snapshotFileName } from './core/snapshot'
import { deriveFreshness } from './core/freshness'
import { SOURCE_META, SOURCE_ORDER, type Dataset, type SourceId } from './core/types'
import {
  ensurePermission,
  pickDirectory,
  pickSessionsDb,
  scanDirectoryHandle,
  scanFileList,
  supportsDirectoryPicker,
  type ScanResult,
} from './platform/browserScan'
import { captureHandles, firstDirectoryHandle, scanDrop } from './platform/dropScan'
import { idbDel, idbGet, idbSet, prefs } from './platform/idb'
import { getPalette } from './ui/theme'
import { Aurora } from './ui/Aurora'
import { FreshnessChips } from './ui/FreshnessChips'
import { SourcePathsButton } from './ui/importPaths'
import { DropOverlay, Toast } from './ui/Overlays'
import {
  isReducedMotion,
  useDashboardReveal,
  useScrollProgress,
  useScrollRefresh,
  useThemeIconFlip,
  useTopbarIntro,
} from './ui/motion'
import { Landing } from './ui/Landing'
import { KpiRow } from './ui/KpiRow'
import { TrendCard, type TrendMode } from './ui/TrendCard'
import { ModelCard } from './ui/ModelCard'
import { HeatCard } from './ui/HeatCard'
import { ProjectCard } from './ui/ProjectCard'
import { SessionCard } from './ui/SessionCard'
import { DistCard } from './ui/DistCard'
import { HealthCard } from './ui/HealthCard'
import { SourceCompareCard } from './ui/SourceCompareCard'

type Status = { text: string; error?: boolean } | null
type SliceMap = Partial<Record<SourceId, Dataset>>
type DirMap = Partial<Record<SourceId, FileSystemDirectoryHandle>>

const PRESETS: Array<{ key: WindowPreset; label: string }> = [
  { key: '7', label: '近 7 天' },
  { key: '30', label: '近 30 天' },
  { key: '90', label: '近 90 天' },
  { key: 'all', label: '全部' },
]

const dirKey = (source: SourceId) => `dir:${source}`

export default function App() {
  const [slices, setSlices] = useState<SliceMap | null>(null)
  const [theme, setTheme] = useState<'dark' | 'light'>(() => prefs.theme())
  const [preset, setPreset] = useState<WindowPreset>('30')
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const [restored, setRestored] = useState(false)
  const [trendMode, setTrendMode] = useState<TrendMode>('usage')
  const [showDate, setShowDate] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [modelFocus, setModelFocus] = useState<string | null>(null)
  const [auto, setAuto] = useState(() => prefs.autoRefresh())
  /** 每个源各自持有目录句柄（ref 不能驱动 UI，所以另存一份可渲染状态） */
  const [hasDir, setHasDir] = useState<Partial<Record<SourceId, boolean>>>({})
  /**
   * 本会话内各源「真的被扫到」的时间戳。同一轮扫描里的多个源共用同一个值，
   * 用于把「本次刷新」和「沿用缓存」区分开（判定逻辑见 core/freshness.ts）。
   */
  const [touched, setTouched] = useState<Partial<Record<SourceId, number>>>({})

  const dirRefs = useRef<DirMap>({})
  const slicesRef = useRef<SliceMap | null>(null)
  const dragDepth = useRef(0)
  const scanRef = useRef<ScanResult | null>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const snapshotInputRef = useRef<HTMLInputElement>(null)
  /** 动效锚点：顶栏 / 仪表盘容器 / 顶部进度条 / 主题按钮 / 品牌标记 */
  const topbarRef = useRef<HTMLElement>(null)
  const brandRef = useRef<HTMLDivElement>(null)
  const stackRef = useRef<HTMLDivElement>(null)
  const progressRef = useRef<HTMLDivElement>(null)
  const themeIconRef = useRef<HTMLButtonElement>(null)

  const palette = useMemo(() => getPalette(theme === 'dark'), [theme])

  useEffect(() => {
    document.body.dataset.theme = theme
    prefs.setTheme(theme)
  }, [theme])

  // 恢复上次数据：重开页面不用再选目录（键名从 dataset 升级为 slices，旧缓存自动迁移）
  useEffect(() => {
    let alive = true
    ;(async () => {
      const saved = await idbGet<SliceMap>('slices')
      if (alive && saved && Object.keys(saved).length) {
        const hasDemo = Object.values(saved).some((d) => d?.isDemo)
        if (hasDemo) {
          void idbDel('slices')
        } else {
          slicesRef.current = saved
          setSlices(saved)
          setRestored(true)
        }
      } else if (alive) {
        const legacy = await idbGet<Dataset>('dataset')
        if (legacy?.isDemo) {
          void idbDel('dataset')
        } else if (legacy?.sessions?.length) {
          const split = splitBySource(legacy)
          slicesRef.current = split
          setSlices(split)
          setRestored(true)
        }
      }

      const cb = await idbGet<FileSystemDirectoryHandle>(dirKey('codebuddy'))
      const wb = await idbGet<FileSystemDirectoryHandle>(dirKey('workbuddy'))
      // 旧版本只有一个 dir 键，且只服务 CodeBuddy
      const legacyDir = await idbGet<FileSystemDirectoryHandle>('dir')
      if (alive) {
        const dirs: DirMap = {}
        if (cb ?? legacyDir) dirs.codebuddy = cb ?? legacyDir ?? undefined
        if (wb) dirs.workbuddy = wb
        dirRefs.current = dirs
        setHasDir({ codebuddy: Boolean(dirs.codebuddy), workbuddy: Boolean(dirs.workbuddy) })
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const dataset = useMemo<Dataset | null>(() => {
    if (!slices) return null
    const list = SOURCE_ORDER.map((s) => slices[s]).filter((d): d is Dataset => Boolean(d))
    if (!list.length) return null
    return mergeSlices(list)
  }, [slices])

  /** 逐源「本次刷新 / 缓存」+ 各自扫描时间；只看真实数据，示例数据不显示 */
  const freshness = useMemo(() => deriveFreshness(slices ?? {}, touched), [slices, touched])

  const win = useMemo(
    () => (custom ? makeCustomWindow(custom.from, custom.to) : makeWindow(preset, dataset?.coverage.first)),
    [custom, preset, dataset],
  )

  const aggPair = useMemo(() => (dataset ? aggregatesBySource(dataset, win) : null), [dataset, win])
  const agg = aggPair?.merged ?? null
  const bySourceAgg = aggPair?.bySource ?? {}

  const persist = useCallback((next: SliceMap | null) => {
    slicesRef.current = next
    setSlices(next)
    setRestored(false)
    if (!next || !Object.keys(next).length) {
      void idbDel('slices')
      return
    }
    // 示例数据只在内存里预览：绝不覆盖真实缓存
    if (Object.values(next).some((d) => d?.isDemo)) return
    void idbSet('slices', next)
  }, [])

  const registerHandle = useCallback((source: SourceId, dir: FileSystemDirectoryHandle | null) => {
    if (!dir) return
    dirRefs.current = { ...dirRefs.current, [source]: dir }
    setHasDir((prev) => ({ ...prev, [source]: true }))
    void idbSet(dirKey(source), dir)
  }, [])

  const handleReset = useCallback(() => {
    scanRef.current = null
    dirRefs.current = {}
    persist(null)
    setHasDir({})
    setTouched({})
    setRestored(false)
    setModelFocus(null)
    setStatus(null)
    setCustom(null)
    setFromDate('')
    setToDate('')
    setPreset('30')
    for (const source of SOURCE_ORDER) void idbDel(dirKey(source))
    void idbDel('slices')
    void idbDel('dataset')
    void idbDel('dir')
  }, [persist])

  /**
   * 一次扫描结果 → 逐源切片，未命中的源保持原样（先 CB 后 WB 不必重扫）。
   * `roundAt` 是「这一轮扫描的开始时间」：同一轮里逐源调用时传同一个值，
   * 否则一轮全量重扫会被记成两个不同轮次，先扫完的那一端反被判成缓存。
   */
  const ingest = useCallback(
    async (res: ScanResult, roundAt: number = Date.now()) => {
      const base = slicesRef.current ?? {}
      const next: SliceMap = { ...base }
      const changed: SourceId[] = []
      const notes: string[] = []
      const t0 = performance.now()

      if (res.cbFiles.length) {
        const ds = buildDataset({
          files: res.cbFiles,
          sessionMeta: res.sessionMeta,
          sources: {
            historyRoots: res.roots.codebuddy,
            scannedAt: res.scannedAt,
            sessionsDb: res.sessionsDbName,
          },
          elapsedMs: Math.round(performance.now() - t0),
        })
        if (ds.sessions.length) {
          next.codebuddy = ds
          changed.push('codebuddy')
          notes.push(`CodeBuddy ${fmtInt(ds.selfCheck.requestsWithUsage)} 请求`)
        }
      } else if (res.sessionMeta.length && next.codebuddy) {
        // 只补了会话库：不重算任何 token
        next.codebuddy = applySessionMeta(next.codebuddy, res.sessionMeta, res.sessionsDbName)
        changed.push('codebuddy')
        notes.push(`CodeBuddy 会话库 ${fmtInt(res.sessionMeta.length)} 条`)
      }

      if (res.wbFiles.length) {
        setStatus({ text: `正在解析 WorkBuddy ${fmtInt(res.wbFiles.length)} 个 jsonl…` })
        const wb = await parseWorkbuddy(res.wbFiles, {
          sources: { historyRoots: res.roots.workbuddy, scannedAt: res.scannedAt },
          elapsedMs: Math.round(performance.now() - t0),
          onProgress: (done, total) => setStatus({ text: `正在解析 WorkBuddy 记录 ${done}/${total} 个文件…` }),
        })
        if (wb.sessions.length) {
          next.workbuddy = wb
          changed.push('workbuddy')
          notes.push(`WorkBuddy ${fmtInt(wb.selfCheck.requestsWithUsage)} 请求`)
        }
      }

      if (!changed.length) {
        setStatus({
          text:
            '没有在所选内容里找到可用用量。CodeBuddy 请选 CodeBuddyExtension\\Data（history/**/index.json）；' +
            'WorkBuddy 请选 ~/.workbuddy 或它的 projects 目录（projects/**/*.jsonl）。',
          error: true,
        })
        return
      }

      scanRef.current = res
      persist(next)
      setTouched((prev) => {
        const next2 = { ...prev }
        for (const source of changed) next2[source] = roundAt
        return next2
      })
      setStatus({ text: `已载入 ${[...new Set(changed)].map((s) => SOURCE_META[s].label).join(' + ')}：${notes.join(' · ')}` })
    },
    [persist],
  )

  const applyScanHandles = useCallback(
    (res: ScanResult, dir: FileSystemDirectoryHandle | null) => {
      if (res.cbFiles.length) registerHandle('codebuddy', dir)
      if (res.wbFiles.length) registerHandle('workbuddy', dir)
    },
    [registerHandle],
  )

  const handlePickDirectory = useCallback(async () => {
    if (!supportsDirectoryPicker()) {
      folderInputRef.current?.click()
      return
    }
    setBusy(true)
    setStatus({ text: '等待选择目录…' })
    // 选择器被系统目录拦下时 Promise 不会立刻 reject，这里给一句救援提示
    const rescue = window.setTimeout(() => {
      setStatus({
        text:
          '如果浏览器提示「此文件夹包含系统文件」，说明 AppData 被拦住：关掉对话框，直接把 Data 文件夹拖进窗口即可。' +
          'WorkBuddy 的 ~/.workbuddy 通常可以直接选。',
      })
    }, 12_000)
    try {
      const dir = await pickDirectory(dirRefs.current.codebuddy ?? dirRefs.current.workbuddy ?? null)
      if (!dir) {
        setBusy(false)
        setStatus(null)
        return
      }
      const res = await scanDirectoryHandle(dir, (stage, done, total) =>
        setStatus({ text: total ? `${stage} ${done}/${total}` : `${stage} ${done}` }),
      )
      applyScanHandles(res, dir)
      await ingest(res)
    } catch (err) {
      const name = (err as DOMException)?.name
      if (name === 'SecurityError' || name === 'NotAllowedError') {
        // file:// 打开或权限策略限制时，目录 API 不可用 → 回落到 <input webkitdirectory>
        setStatus({ text: '当前环境不支持目录选择，已切换为「选择文件夹」文件框（数据一样只在本地解析）。' })
        folderInputRef.current?.click()
      } else {
        setStatus({ text: `扫描失败：${(err as Error)?.message ?? err}`, error: true })
      }
    } finally {
      window.clearTimeout(rescue)
      setBusy(false)
    }
  }, [applyScanHandles, ingest])

  const handleRescan = useCallback(
    async (only?: SourceId) => {
      const targets = (only ? [only] : SOURCE_ORDER).filter((s) => dirRefs.current[s])
      if (!targets.length) {
        setStatus({
          text: dataset?.isDemo
            ? '示例数据没有真实路径，无法重扫。把 Data 或 ~/.workbuddy 文件夹拖进窗口，或点「重置」回初始页。'
            : '当前数据没有可复用的目录句柄（来自快照导入或「文件夹」文件框）。刷新方式：把目录再拖进窗口，或点「目录」重选。',
        })
        return
      }
      setBusy(true)
      // 同一轮内的所有源共用一个时间戳：否则先扫完的一端会被判成「缓存」
      const roundAt = Date.now()
      try {
        for (const source of targets) {
          const dir = dirRefs.current[source]!
          if (!(await ensurePermission(dir))) {
            setHasDir((prev) => ({ ...prev, [source]: false }))
            setStatus({ text: `${SOURCE_META[source].label} 的目录权限被浏览器收回，点「目录」重新选一次即可恢复一键重扫。`, error: true })
            continue
          }
          setStatus({ text: `正在重扫 ${SOURCE_META[source].label}…` })
          const res = await scanDirectoryHandle(dir, (stage, done, total) =>
            setStatus({ text: `${SOURCE_META[source].label} · ${total ? `${stage} ${done}/${total}` : stage}` }),
          )
          await ingest(res, roundAt)
        }
      } catch (err) {
        setStatus({ text: `重新扫描失败：${(err as Error)?.message ?? err}`, error: true })
      } finally {
        setBusy(false)
      }
    },
    [dataset, ingest],
  )

  const handleFolderInput = useCallback(
    async (list: FileList | null) => {
      if (!list || !list.length) return
      setBusy(true)
      setStatus({ text: '正在读取所选文件夹…' })
      try {
        const res = await scanFileList(list)
        await ingest(res)
      } catch (err) {
        setStatus({ text: `读取失败：${(err as Error)?.message ?? err}`, error: true })
      } finally {
        setBusy(false)
      }
    },
    [ingest],
  )

  const handleAddSessionsDb = useCallback(async () => {
    setStatus({ text: '等待选择 codebuddy-sessions.vscdb…' })
    try {
      const picked = await pickSessionsDb()
      if (!picked) {
        setStatus(null)
        return
      }
      const current = slicesRef.current
      if (!current?.codebuddy) {
        setStatus({ text: '请先扫描一次 CodeBuddy 数据目录，再补充会话库。', error: true })
        return
      }
      persist({ ...current, codebuddy: applySessionMeta(current.codebuddy, picked.sessionMeta, picked.name) })
      setStatus({ text: `已补入 CodeBuddy 会话库 ${fmtInt(picked.sessionMeta.length)} 条` })
    } catch (err) {
      setStatus({ text: `读取会话库失败：${(err as Error)?.message ?? err}`, error: true })
    }
  }, [persist])

  const handleDrop = useCallback(
    async (dt: DataTransfer, handles: Array<Promise<FileSystemHandle | null>> = []) => {
      // 句柄必须在 drop 的同步阶段取，事件结束后 items 会失效
      const handlePromise = firstDirectoryHandle(handles)
      setBusy(true)
      setStatus({ text: '正在读取拖入的内容…' })
      try {
        const res = await scanDrop(dt, (stage, done) => setStatus({ text: `${stage} ${done}` }))

        // 只拖了一个快照 JSON
        if (!res.cbFiles.length && !res.wbFiles.length && !res.sessionMeta.length && res.jsonFiles.length) {
          const ds = parseSnapshot(await res.jsonFiles[0].text())
          const split = splitBySource(ds)
          persist({ ...(slicesRef.current ?? {}), ...split })
          // 快照里的时间是它自己生成时的，不是本会话扫的 → 一律按缓存展示
          setTouched({})
          setStatus({ text: `已导入快照：${Object.keys(split).map((s) => SOURCE_META[s as SourceId].label).join(' + ')}` })
          return
        }

        if (res.cbFiles.length || res.wbFiles.length) {
          const scan: ScanResult = {
            cbFiles: res.cbFiles,
            wbFiles: res.wbFiles,
            sessionMeta: res.sessionMeta,
            sessionsDbName: res.sessionsDbName,
            roots: res.historyRoots,
            scannedAt: res.scannedAt,
            elapsedMs: res.elapsedMs,
          }
          const dir = await handlePromise
          applyScanHandles(scan, dir)
          await ingest(scan)
          return
        }

        // 只拖了 codebuddy-sessions.vscdb
        if (res.sessionMeta.length) {
          const current = slicesRef.current
          if (current?.codebuddy) {
            persist({ ...current, codebuddy: applySessionMeta(current.codebuddy, res.sessionMeta, res.sessionsDbName) })
            setStatus({ text: `已补入 CodeBuddy 会话库 ${fmtInt(res.sessionMeta.length)} 条` })
          } else {
            setStatus({ text: '只读到了会话库：还需要把 CodeBuddyExtension\\Data 目录一起拖进来才能看到用量。', error: true })
          }
          return
        }

        setStatus({
          text:
            '没有在拖入的内容里找到用量。支持：CodeBuddyExtension\\Data（history/**/index.json）、' +
            '~/.workbuddy 或 projects（projects/**/*.jsonl）、codebuddy-sessions.vscdb、快照 JSON。',
          error: true,
        })
      } catch (err) {
        setStatus({ text: `读取失败：${(err as Error)?.message ?? err}`, error: true })
      } finally {
        setBusy(false)
      }
    },
    [applyScanHandles, ingest, persist],
  )

  // 拖拽：浏览器拒绝打开 AppData 这类系统目录，但拖拽读取不受限制
  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      dragDepth.current += 1
      setDragging(true)
    }
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const onLeave = () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (!dragDepth.current) setDragging(false)
    }
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer) return
      e.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      const handles = captureHandles(e.dataTransfer)
      void handleDrop(e.dataTransfer, handles)
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [handleDrop])

  const handleImportSnapshot = useCallback(
    async (file: File | null) => {
      if (!file) return
      try {
        const ds = parseSnapshot(await file.text())
        if (!ds.sessions.length) throw new Error('快照里没有会话')
        const split = splitBySource(ds)
        persist({ ...(slicesRef.current ?? {}), ...split })
        setTouched({})
        setStatus({ text: `已导入快照：${Object.keys(split).map((s) => SOURCE_META[s as SourceId].label).join(' + ')}` })
      } catch (err) {
        setStatus({ text: `导入失败：${(err as Error)?.message ?? err}`, error: true })
      }
    },
    [persist],
  )

  const handleExport = useCallback(() => {
    if (!dataset) return
    const blob = new Blob([serializeDataset(dataset)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = snapshotFileName(new Date(), Object.keys(dataset.bySource) as SourceId[])
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
  }, [dataset])

  const handleDemo = useCallback(() => {
    scanRef.current = null
    setTouched({})
    persist(splitBySource(buildDemoDataset()))
  }, [persist])

  // 自动刷新：仅在仍持有目录权限时静默重扫，逐源进行
  useEffect(() => {
    prefs.setAutoRefresh(auto)
    if (!auto || !dataset) return
    const timer = window.setInterval(async () => {
      const roundAt = Date.now()
      for (const source of SOURCE_ORDER) {
        const dir = dirRefs.current[source]
        if (!dir || !(await ensurePermission(dir))) continue
        try {
          const res = await scanDirectoryHandle(dir)
          await ingest(res, roundAt)
        } catch {
          /* 静默失败，不打扰 */
        }
      }
    }, 5 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [auto, dataset, ingest])

  useEffect(() => {
    setModelFocus(null)
  }, [dataset, preset, custom])

  // 仪表盘里也必须有非错误状态的反馈（否则「重扫」这类操作点了像没反应），
  // 扫描中的进度不自动消失，单纯的提示 4.2s 后收起；错误另走 banner。
  useEffect(() => {
    if (!dataset || !status || status.error) return
    if (busy) return
    const timer = window.setTimeout(() => setStatus((s) => (s === status ? null : s)), 4200)
    return () => window.clearTimeout(timer)
  }, [status, dataset, busy])

  const applyCustom = (nextFrom: string, nextTo: string) => {
    setFromDate(nextFrom)
    setToDate(nextTo)
    if (nextFrom && nextTo && nextFrom <= nextTo) setCustom({ from: nextFrom, to: nextTo })
    else if (!nextFrom && !nextTo) setCustom(null)
  }

  const loadedSources = dataset ? (Object.keys(dataset.bySource) as SourceId[]) : []
  const canRescan = SOURCE_ORDER.some((s) => hasDir[s])
  const showDashboard = Boolean(dataset && agg)

  // 动效：顶栏入场、滚动进度、卡片分批浮现、主题按钮翻身
  useTopbarIntro(topbarRef)
  useScrollProgress(progressRef)
  useDashboardReveal(stackRef, showDashboard)
  useThemeIconFlip(themeIconRef, theme)
  // 换窗口后卡片高度会变，触发器位置要重算
  useScrollRefresh([agg, preset, custom])

  // 数据载入/刷新完成时给 logo 扫一道高光：一次性事件，不做常驻循环（常驻多占 ~5 点 GPU）
  useEffect(() => {
    const el = brandRef.current
    if (!el || !dataset || isReducedMotion()) return
    el.classList.remove('sheen')
    void el.offsetWidth
    el.classList.add('sheen')
    const done = () => el.classList.remove('sheen')
    el.addEventListener('animationend', done, { once: true })
    return () => el.removeEventListener('animationend', done)
  }, [dataset])

  return (
    <>
      <Aurora />
      <div className="scroll-progress" ref={progressRef} aria-hidden="true" />
      <div className="shell">
        <header className="topbar" ref={topbarRef}>
          <div className="brand">
            <div className="brand-mark" ref={brandRef} aria-hidden="true">
              BB
            </div>
            <div className="brand-text">
              <h1>Buddy 用量看板</h1>
              <div className="meta">
                {dataset && agg
                  ? `${loadedSources.map((s) => SOURCE_META[s].label).join(' + ') || '无数据'} · ${fmtInt(agg.totals.requests)} 请求 · ${fmtTokens(agg.totals.total)} token`
                  : 'CodeBuddy + WorkBuddy · 纯前端 · 数据不出本机'}
              </div>
              {dataset && agg && !dataset.isDemo ? <FreshnessChips freshness={freshness} /> : null}
            </div>
          </div>

          <div className="spacer" />

          {dataset ? (
            <div className="controls">
              <div className="seg">
                {PRESETS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    aria-pressed={!custom && preset === p.key}
                    onClick={() => {
                      setCustom(null)
                      setFromDate('')
                      setToDate('')
                      setPreset(p.key)
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              {showDate || custom ? (
                <>
                  <input
                    className="datepick btn"
                    type="date"
                    value={fromDate}
                    onChange={(e) => applyCustom(e.target.value, toDate)}
                    title="自定义起始日期"
                    aria-label="自定义起始日期"
                  />
                  <input
                    className="datepick btn"
                    type="date"
                    value={toDate}
                    onChange={(e) => applyCustom(fromDate, e.target.value)}
                    title="自定义结束日期"
                    aria-label="自定义结束日期"
                  />
                </>
              ) : (
                <button type="button" className="btn ghost" onClick={() => setShowDate(true)} title="按日期区间筛选">
                  日期
                </button>
              )}
              <button
                type="button"
                className="btn ghost"
                onClick={() => void handleRescan()}
                disabled={busy}
                title={canRescan ? '按上次的目录重新扫描，读到最新用量' : '当前数据没有可复用的目录句柄：点一下会提示怎么刷新'}
              >
                {busy ? <span className="spin" /> : '↻'} 重扫
              </button>
              <button type="button" className="btn ghost" onClick={() => void handlePickDirectory()} disabled={busy} title="选择或新增一个数据目录（自动识别 CodeBuddy / WorkBuddy）">
                目录
              </button>
              <SourcePathsButton />
              <button type="button" className="btn ghost" onClick={handleExport} title="导出快照 JSON">
                导出
              </button>
              <button type="button" className="btn ghost" onClick={handleReset} title="清除本地缓存并回到初始页（不影响磁盘上的原始数据）">
                重置
              </button>
              <button
                type="button"
                className={`btn ghost${auto ? ' on' : ''}`}
                onClick={() => setAuto(!auto)}
                title="每 5 分钟自动重扫（需要保留目录权限）"
                style={auto ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
              >
                自动
              </button>
              <button
                ref={themeIconRef}
                type="button"
                className="btn icon ghost"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                title="切换明暗主题"
                aria-label="切换明暗主题"
              >
                {theme === 'dark' ? '☾' : '☀'}
              </button>
            </div>
          ) : (
            <div className="controls">
              <button
                ref={themeIconRef}
                type="button"
                className="btn icon ghost"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                title="切换明暗主题"
                aria-label="切换明暗主题"
              >
                {theme === 'dark' ? '☾' : '☀'}
              </button>
            </div>
          )}
        </header>

        {!dataset || !agg ? (
          <Landing
            onPickDirectory={() => void handlePickDirectory()}
            onPickFallback={() => folderInputRef.current?.click()}
            onImport={() => snapshotInputRef.current?.click()}
            onDemo={handleDemo}
            status={status}
            busy={busy}
            supportsDirectory={supportsDirectoryPicker()}
          />
        ) : (
          <div className="stack" ref={stackRef}>
            {dataset.isDemo ? (
              <div className="banner info">
                当前是<b>示例数据</b>（合成的双端用量，不含任何真实路径），仅用于预览界面，不会写入本地缓存。
                <button type="button" className="btn" onClick={handleReset}>
                  退出示例
                </button>
              </div>
            ) : null}

            {restored && !dataset.isDemo ? (
              <div className="banner info">
                {canRescan
                  ? '已恢复上次扫描结果（缓存快照）。点「重扫」读取最新用量。'
                  : '已恢复上次扫描结果（缓存快照）。这份数据没有可复用的目录句柄，想刷新请把数据目录再拖进窗口。'}
                {canRescan ? (
                  <button type="button" className="btn" onClick={() => void handleRescan()} disabled={busy}>
                    {busy ? '扫描中…' : '重新扫描'}
                  </button>
                ) : null}
              </div>
            ) : null}

            {slices?.codebuddy && !dataset.bySource.codebuddy?.info.sessionsDb ? (
              <div className="banner">
                未提供 <code>codebuddy-sessions.vscdb</code>：CodeBuddy 的标题与项目路径暂缺。把该文件从
                <code>%APPDATA%\CodeBuddy CN\</code> <b>直接拖进窗口</b>即可补上（AppData 是系统目录，选择器打不开它）。
                <button type="button" className="btn" onClick={() => void handleAddSessionsDb()}>
                  仍然尝试选择文件
                </button>
              </div>
            ) : null}

            {status?.error ? <div className="banner" style={{ borderLeftColor: 'var(--danger)' }}>{status.text}</div> : null}

            {agg.requestCountInWindow === 0 ? (
              <div className="banner">当前时间窗口内没有请求记录。试试切换到「全部」，或把日期区间放宽。</div>
            ) : null}

            <KpiRow agg={agg} />

            <SourceCompareCard merged={agg} bySource={bySourceAgg} palette={palette} onAdd={() => void handlePickDirectory()} busy={busy} />

            <div className="grid two">
              <TrendCard agg={agg} palette={palette} mode={trendMode} onMode={setTrendMode} />
              <ModelCard agg={agg} palette={palette} focus={modelFocus} onFocus={setModelFocus} />
            </div>

            <div className="grid two">
              <HeatCard agg={agg} palette={palette} />
              <ProjectCard agg={agg} palette={palette} />
            </div>

            <SessionCard agg={agg} palette={palette} modelFocus={modelFocus} onClearFocus={() => setModelFocus(null)} />

            <div className="grid two right-wide">
              <DistCard agg={agg} palette={palette} />
              <HealthCard dataset={dataset} agg={agg} freshness={freshness} onExport={handleExport} />
            </div>
          </div>
        )}
      </div>

      {dataset && status && !status.error ? <Toast text={status.text} busy={busy} /> : null}

      {dragging ? <DropOverlay /> : null}

      <footer className="foot">
        <span>
          {dataset ? `窗口：${agg?.window.label} · ${dataset.coverage.first ?? '—'} → ${dataset.coverage.last ?? '—'}` : '等待选择数据目录'}
          {dataset?.generatedAt ? ` · 快照生成于 ${new Date(dataset.generatedAt).toLocaleString('zh-CN')}` : ''}
        </span>
      </footer>

      <input
        ref={folderInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          void handleFolderInput(e.target.files)
          e.target.value = ''
        }}
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
      />
      <input
        ref={snapshotInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={(e) => {
          void handleImportSnapshot(e.target.files?.[0] ?? null)
          e.target.value = ''
        }}
      />
    </>
  )
}
