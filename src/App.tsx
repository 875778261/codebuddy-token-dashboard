import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { aggregate, makeCustomWindow, makeWindow, type WindowPreset } from './core/aggregate'
import { buildDemoDataset } from './core/demo'
import { fmtInt, fmtTokens } from './core/format'
import { applySessionMeta, buildDataset, type ScannedFile } from './core/parse'
import { parseSnapshot, serializeDataset, snapshotFileName } from './core/snapshot'
import type { Dataset, SessionMeta, SourceInfo } from './core/types'
import { scanDirectoryHandle, scanFileList, ensurePermission, pickDirectory, pickSessionsDb, supportsDirectoryPicker } from './platform/browserScan'
import { captureHandles, firstDirectoryHandle, scanDrop } from './platform/dropScan'
import { idbDel, idbGet, idbSet, prefs } from './platform/idb'
import { getPalette } from './ui/theme'
import { Landing } from './ui/Landing'
import { KpiRow } from './ui/KpiRow'
import { TrendCard, type TrendMode } from './ui/TrendCard'
import { ModelCard } from './ui/ModelCard'
import { HeatCard } from './ui/HeatCard'
import { ProjectCard } from './ui/ProjectCard'
import { SessionCard } from './ui/SessionCard'
import { DistCard } from './ui/DistCard'
import { HealthCard } from './ui/HealthCard'

type Status = { text: string; error?: boolean } | null
type ScanSources = Omit<SourceInfo, 'projectCount' | 'convIndexCount' | 'sessionMetaCount'>

const PRESETS: Array<{ key: WindowPreset; label: string }> = [
  { key: '7', label: '近 7 天' },
  { key: '30', label: '近 30 天' },
  { key: '90', label: '近 90 天' },
  { key: 'all', label: '全部' },
]

export default function App() {
  const [dataset, setDataset] = useState<Dataset | null>(null)
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
  /** 是否持有可复用的目录句柄（决定「重扫」能不能真的刷新，ref 不能驱动 UI） */
  const [hasDir, setHasDir] = useState(false)

  const dirRef = useRef<FileSystemDirectoryHandle | null>(null)
  const dragDepth = useRef(0)
  const scanRef = useRef<{ files: ScannedFile[]; sessionMeta: SessionMeta[]; sources: ScanSources } | null>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const snapshotInputRef = useRef<HTMLInputElement>(null)

  const palette = useMemo(() => getPalette(theme === 'dark'), [theme])

  useEffect(() => {
    document.body.dataset.theme = theme
    prefs.setTheme(theme)
  }, [theme])

  // 恢复上次数据：重开页面不用再选目录
  useEffect(() => {
    let alive = true
    ;(async () => {
      const saved = await idbGet<Dataset>('dataset')
      if (alive && saved?.isDemo) {
        // 旧版本曾把示例数据写进缓存，这里顺手清掉，避免"示例"冒充真实数据
        void idbDel('dataset')
      } else if (alive && saved && Array.isArray(saved.sessions) && saved.sessions.length) {
        setDataset(saved)
        setRestored(true)
      }
      const handle = await idbGet<FileSystemDirectoryHandle>('dir')
      if (alive && handle) {
        dirRef.current = handle
        setHasDir(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const win = useMemo(
    () => (custom ? makeCustomWindow(custom.from, custom.to) : makeWindow(preset, dataset?.coverage.first)),
    [custom, preset, dataset],
  )

  const agg = useMemo(() => (dataset ? aggregate(dataset, win) : null), [dataset, win])

  const persist = useCallback((ds: Dataset) => {
    setDataset(ds)
    setRestored(false)
    // 示例数据只在内存里预览：绝不覆盖真实缓存
    if (ds.isDemo) return
    idbSet('dataset', ds)
  }, [])

  const handleReset = useCallback(() => {
    scanRef.current = null
    dirRef.current = null
    setHasDir(false)
    setDataset(null)
    setRestored(false)
    setModelFocus(null)
    setStatus(null)
    setCustom(null)
    setFromDate('')
    setToDate('')
    setPreset('30')
    void idbDel('dataset')
    void idbDel('dir')
  }, [])

  const rebuild = useCallback(
    (files: ScannedFile[], sessionMeta: SessionMeta[], sources: ScanSources) => {
      const t0 = performance.now()
      const ds = buildDataset({ files, sessionMeta, sources, elapsedMs: Math.round((sources.elapsedMs ?? 0) + (performance.now() - t0)) })
      if (!ds.sessions.length) {
        setStatus({ text: '在所选目录里没有找到带 usage 的请求记录（history/**/index.json）。请确认选到 CodeBuddyExtension\\Data 或其上层目录。', error: true })
        return
      }
      setStatus(null)
      persist(ds)
    },
    [persist],
  )

  const finishScan = useCallback(
    (res: { files: ScannedFile[]; sessionMeta: SessionMeta[]; sources: ScanSources }) => {
      scanRef.current = res
      rebuild(res.files, res.sessionMeta, res.sources)
    },
    [rebuild],
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
      setStatus({ text: '如果浏览器提示「此文件夹包含系统文件」，说明 AppData 被拦住：关掉对话框，直接把 Data 文件夹拖进窗口即可。' })
    }, 12_000)
    try {
      const dir = await pickDirectory(dirRef.current)
      if (!dir) {
        setBusy(false)
        setStatus(null)
        return
      }
      dirRef.current = dir
      setHasDir(true)
      idbSet('dir', dir)
      const res = await scanDirectoryHandle(dir, (stage, done, total) =>
        setStatus({ text: total ? `${stage} ${done}/${total}` : `${stage} ${done}` }),
      )
      finishScan(res)
    } catch (err) {
      const name = (err as DOMException)?.name
      if (name === 'SecurityError' || name === 'NotAllowedError') {
        // file:// 打开或权限策略限制时，目录 API 不可用 → 回落到 <input webkitdirectory>
        setStatus({ text: '当前环境不支持目录选择，已切换为「选择文件夹」文件框（目录里的 usage 一样只在本地解析）。' })
        folderInputRef.current?.click()
      } else {
        setStatus({ text: `扫描失败：${(err as Error)?.message ?? err}`, error: true })
      }
    } finally {
      window.clearTimeout(rescue)
      setBusy(false)
    }
  }, [finishScan])

  const handleRescan = useCallback(async () => {
    const dir = dirRef.current
    if (!dir) {
      // 快照导入 / 文件夹文件框进来的数据没有目录句柄，浏览器不会替我们记住路径：
      // 这里必须明说下一步怎么做，否则按钮看起来就是"点了没反应"
      setStatus({
        text: dataset?.isDemo
          ? '示例数据没有真实路径，无法重扫。把 CodeBuddyExtension\\Data 文件夹拖进窗口，或点「重置」回初始页。'
          : '当前数据没有可复用的目录句柄（来自快照导入或「文件夹」文件框）。刷新方式：把 Data 文件夹再拖进窗口，或点「目录」重选。',
      })
      return
    }
    setBusy(true)
    setStatus({ text: '重新扫描中…' })
    try {
      if (!(await ensurePermission(dir))) {
        setBusy(false)
        setHasDir(false)
        setStatus({ text: '浏览器收回了上次目录的读取权限，点「目录」重新选一次即可恢复一键重扫。', error: true })
        return
      }
      const res = await scanDirectoryHandle(dir, (stage, done, total) => setStatus({ text: total ? `${stage} ${done}/${total}` : stage }))
      finishScan(res)
    } catch (err) {
      setStatus({ text: `重新扫描失败：${(err as Error)?.message ?? err}`, error: true })
    } finally {
      setBusy(false)
    }
  }, [finishScan, dataset])

  const handleFolderInput = useCallback(
    async (list: FileList | null) => {
      if (!list || !list.length) return
      setBusy(true)
      setStatus({ text: '正在读取所选文件夹…' })
      try {
        const res = await scanFileList(list)
        finishScan(res)
      } catch (err) {
        setStatus({ text: `读取失败：${(err as Error)?.message ?? err}`, error: true })
      } finally {
        setBusy(false)
      }
    },
    [finishScan],
  )

  const handleAddSessionsDb = useCallback(async () => {
    setStatus({ text: '等待选择 codebuddy-sessions.vscdb…' })
    try {
      const picked = await pickSessionsDb()
      if (!picked) {
        setStatus(null)
        return
      }
      const base = scanRef.current
      if (!base) {
        if (dataset) {
          persist(applySessionMeta(dataset, picked.sessionMeta, picked.name))
          setStatus(null)
          return
        }
        setStatus({ text: '请先扫描一次数据目录，再补充会话库。', error: true })
        return
      }
      finishScan({ ...base, sessionMeta: picked.sessionMeta, sources: { ...base.sources, sessionsDb: picked.name } })
    } catch (err) {
      setStatus({ text: `读取会话库失败：${(err as Error)?.message ?? err}`, error: true })
    }
  }, [finishScan, dataset, persist])

  const handleDrop = useCallback(
    async (dt: DataTransfer, handles: Array<Promise<FileSystemHandle | null>> = []) => {
      // 顺手把拖入目录的句柄存下来，之后「重扫 / 自动刷新」才有得可用
      void firstDirectoryHandle(handles).then((dir) => {
        if (!dir) return
        dirRef.current = dir
        setHasDir(true)
        idbSet('dir', dir)
      })
      setBusy(true)
      setStatus({ text: '正在读取拖入的内容…' })
      try {
        const res = await scanDrop(dt, (stage, done) => setStatus({ text: `${stage} ${done}` }))

        // 只拖了一个快照 JSON
        if (!res.files.length && res.jsonFiles.length) {
          const ds = parseSnapshot(await res.jsonFiles[0].text())
          scanRef.current = null
          persist(ds)
          setStatus(null)
          return
        }

        if (res.files.length) {
          finishScan({
            files: res.files,
            sessionMeta: res.sessionMeta,
            sources: {
              historyRoots: res.historyRoots.length ? res.historyRoots : res.roots,
              sessionsDb: res.sessionsDbName,
              scannedAt: new Date().toISOString(),
              elapsedMs: res.elapsedMs,
            },
          })
          return
        }

        // 只拖了 codebuddy-sessions.vscdb
        if (res.sessionMeta.length) {
          if (scanRef.current) {
            finishScan({
              ...scanRef.current,
              sessionMeta: res.sessionMeta,
              sources: { ...scanRef.current.sources, sessionsDb: res.sessionsDbName },
            })
          } else if (dataset) {
            persist(applySessionMeta(dataset, res.sessionMeta, res.sessionsDbName))
            setStatus(null)
          } else {
            setStatus({ text: '只读到了会话库：还需要把 CodeBuddyExtension\\Data 目录一起拖进来才能看到用量。', error: true })
          }
          return
        }

        setStatus({
          text: '没有在拖入的内容里找到 history/**/index.json 或 codebuddy-sessions.vscdb。确认拖的是 CodeBuddyExtension\\Data 这个文件夹本身。',
          error: true,
        })
      } catch (err) {
        setStatus({ text: `读取失败：${(err as Error)?.message ?? err}`, error: true })
      } finally {
        setBusy(false)
      }
    },
    [dataset, finishScan, persist],
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
      // 句柄必须在 drop 的同步阶段取，事件结束后 items 会失效
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

  const handleImportSnapshot = useCallback(async (file: File | null) => {
    if (!file) return
    try {
      const ds = parseSnapshot(await file.text())
      if (!ds.sessions.length) throw new Error('快照里没有会话')
      scanRef.current = null
      persist(ds)
      setStatus(null)
    } catch (err) {
      setStatus({ text: `导入失败：${(err as Error)?.message ?? err}`, error: true })
    }
  }, [persist])

  const handleExport = useCallback(() => {
    if (!dataset) return
    const blob = new Blob([serializeDataset(dataset)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = snapshotFileName()
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
  }, [dataset])

  const handleDemo = useCallback(() => {
    scanRef.current = null
    persist(buildDemoDataset())
  }, [persist])

  // 自动刷新：仅在仍持有目录权限时静默重扫
  useEffect(() => {
    prefs.setAutoRefresh(auto)
    if (!auto || !dataset) return
    const timer = window.setInterval(async () => {
      const dir = dirRef.current
      if (!dir || !(await ensurePermission(dir))) return
      try {
        const res = await scanDirectoryHandle(dir)
        finishScan(res)
      } catch {
        /* 静默失败，不打扰 */
      }
    }, 5 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [auto, dataset, finishScan])

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

  return (
    <>
      <div className="shell">
        <header className="topbar">
          <div className="brand">
            <div className="brand-mark">CB</div>
            <div className="brand-text">
              <h1>CodeBuddy 用量看板</h1>
              <div className="meta">
                {dataset && agg
                  ? `${dataset.sources.sessionsDb ? 'history + 会话库' : 'history'} · ${fmtInt(agg.totals.requests)} 请求 · ${fmtTokens(agg.totals.total)} token · 扫描 ${dataset.sources.elapsedMs} ms`
                  : '纯前端 · 数据不出本机'}
              </div>
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
                onClick={handleRescan}
                disabled={busy}
                title={hasDir ? '按上次的目录重新扫描，读到最新用量' : '当前数据没有可复用的目录句柄：点一下会提示怎么刷新'}
              >
                {busy ? <span className="spin" /> : '↻'} 重扫
              </button>
              <button type="button" className="btn ghost" onClick={handlePickDirectory} disabled={busy} title="更换数据目录">
                目录
              </button>
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
              <button type="button" className="btn icon ghost" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title="切换明暗主题" aria-label="切换明暗主题">
                {theme === 'dark' ? '☾' : '☀'}
              </button>
            </div>
          ) : (
            <div className="controls">
              <button type="button" className="btn icon ghost" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title="切换明暗主题" aria-label="切换明暗主题">
                {theme === 'dark' ? '☾' : '☀'}
              </button>
            </div>
          )}
        </header>

        {!dataset || !agg ? (
          <Landing
            onPickDirectory={handlePickDirectory}
            onPickFallback={() => folderInputRef.current?.click()}
            onImport={() => snapshotInputRef.current?.click()}
            onDemo={handleDemo}
            status={status}
            busy={busy}
            supportsDirectory={supportsDirectoryPicker()}
          />
        ) : (
          <div className="stack">
            {dataset.isDemo ? (
              <div className="banner info">
                当前是<b>示例数据</b>（合成的 64 天用量，不含任何真实路径），仅用于预览界面，不会写入本地缓存。
                <button type="button" className="btn" onClick={handleReset}>
                  退出示例
                </button>
              </div>
            ) : null}

            {restored && !dataset.isDemo ? (
              <div className="banner info">
                {hasDir
                  ? '已恢复上次扫描结果（缓存快照）。点「重新扫描」读取最新用量。'
                  : '已恢复上次扫描结果（缓存快照）。这份数据没有可复用的目录句柄，想刷新请把 Data 文件夹再拖进窗口。'}
                {hasDir ? (
                  <button type="button" className="btn" onClick={handleRescan} disabled={busy}>
                    {busy ? '扫描中…' : '重新扫描'}
                  </button>
                ) : null}
              </div>
            ) : null}

            {!dataset.sources.sessionsDb ? (
              <div className="banner">
                未提供 <code>codebuddy-sessions.vscdb</code>：标题与项目路径暂缺。把该文件从
                <code>%APPDATA%\CodeBuddy CN\</code> <b>直接拖进窗口</b>即可补上（AppData 是系统目录，选择器打不开它）。
                <button type="button" className="btn" onClick={handleAddSessionsDb}>
                  仍然尝试选择文件
                </button>
              </div>
            ) : null}

            {status?.error ? <div className="banner" style={{ borderLeftColor: 'var(--danger)' }}>{status.text}</div> : null}

            {agg.requestCountInWindow === 0 ? (
              <div className="banner">
                当前时间窗口内没有请求记录。试试切换到「全部」，或把日期区间放宽。
              </div>
            ) : null}

            <KpiRow agg={agg} />

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
              <HealthCard dataset={dataset} agg={agg} onExport={handleExport} />
            </div>
          </div>
        )}
      </div>

      {dataset && status && !status.error ? (
        <div className="toast-stack" aria-live="polite">
          <div className="toast">
            {busy ? <span className="spin" /> : null}
            <span>{status.text}</span>
          </div>
        </div>
      ) : null}

      {dragging ? (
        <div className="drop-overlay">
          <div className="drop-card">
            <div className="drop-icon">↓</div>
            <b>松手即读取</b>
            <span>
              支持 <code>CodeBuddyExtension\Data</code> 文件夹、<code>codebuddy-sessions.vscdb</code>，或快照 JSON
              <br />
              全部在本地解析，不会离开这台机器
            </span>
          </div>
        </div>
      ) : null}

      <footer className="foot">
        <span>
          {dataset ? `窗口：${agg?.window.label} · ${dataset.coverage.first ?? '—'} → ${dataset.coverage.last ?? '—'}` : '等待选择数据目录'}
          {dataset?.generatedAt ? ` · 快照生成于 ${new Date(dataset.generatedAt).toLocaleString('zh-CN')}` : ''}
        </span>
        {/* <span>纯前端 · 解析口径见 docs/data-sources.md · 数据不上传</span> */}
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
