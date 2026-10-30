import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { SourceId } from '../core/types'

/**
 * 三个导入入参路径的唯一定义处。
 * Landing、顶栏 popover、端对比引导态都从这里取，不允许各自复制一份字符串
 * （路径随平台变化，分散之后必然漂移）。
 */

export const IS_WIN = typeof navigator !== 'undefined' && /Win/i.test(navigator.userAgent)
export const IS_FILE = typeof location !== 'undefined' && location.protocol === 'file:'

const DATA_PATH = IS_WIN
  ? '%LOCALAPPDATA%\\CodeBuddyExtension\\Data'
  : '~/Library/Application Support/CodeBuddyExtension/Data'
const DB_PATH = IS_WIN
  ? '%APPDATA%\\CodeBuddy CN\\codebuddy-sessions.vscdb'
  : '~/Library/Application Support/CodeBuddy CN/codebuddy-sessions.vscdb'
const WB_PATH = IS_WIN ? '%USERPROFILE%\\.workbuddy' : '~/.workbuddy'

export type ImportPathKey = SourceId | 'sessions'

export interface ImportPath {
  key: ImportPathKey
  /** UI 上的固定标签 */
  label: string
  value: string
  /** 拖进去之后会被识别成什么（popover 里用来说明"为什么是它"） */
  hint: string
  /** 可选入参：缺了只影响标题/项目路径，不影响用量 */
  optional?: boolean
}

export const IMPORT_PATHS: ImportPath[] = [
  { key: 'codebuddy', label: 'CodeBuddy', value: DATA_PATH, hint: 'history/**/index.json' },
  { key: 'workbuddy', label: 'WorkBuddy', value: WB_PATH, hint: 'projects/**/*.jsonl' },
  { key: 'sessions', label: 'CodeBuddy 会话库（可选）', value: DB_PATH, hint: '补标题与项目路径', optional: true },
]

/** 某个源对应的用量数据根；`sessions` 不属于任何一端 */
export function importPathOf(key: ImportPathKey): ImportPath {
  return IMPORT_PATHS.find((p) => p.key === key) ?? IMPORT_PATHS[0]
}

export function CopyPath({ value }: { value: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className="btn ghost"
      title={`复制 ${value}`}
      aria-label={`复制路径 ${value}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setDone(true)
          setTimeout(() => setDone(false), 1400)
        } catch {
          /* 剪贴板被拒（file:// 或未授权）时静默：路径本身可手动选中 */
        }
      }}
    >
      {done ? '已复制' : '复制'}
    </button>
  )
}

/** 一个「标签 + 路径 + 复制」块。类名 .pathbox 被 Landing 入场动画选中，别改名 */
export function PathBox({ item }: { item: ImportPath }) {
  return (
    <div className="pathbox">
      <span className="label">{item.label}</span>
      <code>{item.value}</code>
      <CopyPath value={item.value} />
    </div>
  )
}

/** 三个路径一起排（Landing 用） */
export function PathList() {
  return (
    <>
      {IMPORT_PATHS.map((item) => (
        <PathBox key={item.key} item={item} />
      ))}
    </>
  )
}

/**
 * 顶栏的「路径」popover：仪表盘状态下也能查到、复制三个入参路径。
 *
 * 开合不做动画，也不常驻任何 transform/opacity 补间——它挂在带 backdrop-filter 的顶栏里，
 * 任何每帧变化的属性都会逼顶栏重新合成模糊层（实测红线，见 app.css 文末段）。
 */
export function SourcePathsButton() {
  const [open, setOpen] = useState(false)
  /** 面板左边界越出视口时整体右移，避免窄窗口下拖出屏幕 */
  const [shift, setShift] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const wrap = wrapRef.current
      const pop = popRef.current
      if (!wrap || !pop) return
      const overflowLeft = 8 - (wrap.getBoundingClientRect().right - pop.offsetWidth)
      setShift(overflowLeft > 0 ? Math.round(overflowLeft) : 0)
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="path-menu" ref={wrapRef}>
      <button
        type="button"
        className={`btn ghost${open ? ' on' : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
        title="查看并复制三个导入路径（换机、补另一端时不用回初始页）"
      >
        路径
      </button>
      {open ? (
        <div
          className="path-pop"
          role="dialog"
          aria-label="导入路径"
          ref={popRef}
          style={shift ? { transform: `translateX(${shift}px)` } : undefined}
        >
          <div className="path-pop-head">
            <b>导入路径</b>
            <span>把文件夹拖进窗口任意位置即可，不必先打开它</span>
          </div>
          <div className="path-pop-list">
            {IMPORT_PATHS.map((item) => (
              <PathBox key={item.key} item={item} />
            ))}
          </div>
          <div className="path-pop-foot">
            {IS_FILE
              ? 'file:// 下拖拽不可用：请用本地服务打开，或直接导入快照 JSON。'
              : '两端可以分两次给：后给的一端只更新自己那一端，不会重扫另一端。'}
          </div>
        </div>
      ) : null}
    </div>
  )
}
