import { useState } from 'react'

const IS_WIN = typeof navigator !== 'undefined' && /Win/i.test(navigator.userAgent)
const IS_FILE = typeof location !== 'undefined' && location.protocol === 'file:'

const DATA_PATH = IS_WIN ? '%LOCALAPPDATA%\\CodeBuddyExtension\\Data' : '~/Library/Application Support/CodeBuddyExtension/Data'
const DB_PATH = IS_WIN ? '%APPDATA%\\CodeBuddy CN\\codebuddy-sessions.vscdb' : '~/Library/Application Support/CodeBuddy CN/codebuddy-sessions.vscdb'
const WB_PATH = IS_WIN ? '%USERPROFILE%\\.workbuddy' : '~/.workbuddy'

function CopyPath({ value }: { value: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className="btn ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setDone(true)
          setTimeout(() => setDone(false), 1400)
        } catch {
          /* 忽略 */
        }
      }}
    >
      {done ? '已复制' : '复制'}
    </button>
  )
}

export function Landing({
  onPickDirectory,
  onPickFallback,
  onImport,
  onDemo,
  status,
  busy,
  supportsDirectory,
}: {
  onPickDirectory: () => void
  onPickFallback: () => void
  onImport: () => void
  onDemo: () => void
  status: { text: string; error?: boolean } | null
  busy: boolean
  supportsDirectory: boolean
}) {
  return (
    <div className="landing">
      <section className="hero">
        <h2>本机 AI 用量总账，全部留在本机</h2>
        <p>
          把 <b>CodeBuddy</b> 或 <b>WorkBuddy</b> 的数据目录<b>拖进窗口</b>（或选择它）。只给一端就看这一端；两端都给就合并成一份总账，并单独给出<b>端对比</b>。
          浏览器直接读取请求级 <code>usage</code>，统计 Token、积分、缓存命中、项目与会话分布。
        </p>
        <p className="privacy">
          <b>解析与聚合只发生在你的浏览器里</b>，不上传、不离线缓存到任何服务器；关掉标签页就什么都没有。
        </p>

        <div className="pathbox">
          <span className="label">CodeBuddy</span>
          <code>{DATA_PATH}</code>
          <CopyPath value={DATA_PATH} />
        </div>
        <div className="pathbox" style={{ marginTop: 6 }}>
          <span className="label">WorkBuddy</span>
          <code>{WB_PATH}</code>
          <CopyPath value={WB_PATH} />
        </div>
        <div className="pathbox" style={{ marginTop: 6 }}>
          <span className="label">CodeBuddy 会话库（可选）</span>
          <code>{DB_PATH}</code>
          <CopyPath value={DB_PATH} />
        </div>
        <p style={{ fontSize: 11.5, color: 'var(--ink-4)', marginTop: 4 }}>
          两端可以分两次拖：后拖的只更新自己那一端，不会重扫另一端。会话库只用于补 CodeBuddy 的标题与项目路径。
        </p>

        <div className="hero-actions">
          <button type="button" className="btn primary" onClick={supportsDirectory ? onPickDirectory : onPickFallback} disabled={busy}>
            {busy ? <span className="spin" /> : null}
            {busy ? '扫描中…' : supportsDirectory ? '选择数据目录' : '选择文件夹'}
          </button>
          <button type="button" className="btn" onClick={onImport} disabled={busy}>
            导入快照 JSON
          </button>
          <button type="button" className="btn ghost" onClick={onDemo} disabled={busy}>
            先看示例数据
          </button>
        </div>

        {status ? <div className={`status-line${status.error ? ' error' : ''}`}>{status.text}</div> : null}

        <div className="dropzone">
          <b>{IS_FILE ? '当前是 file:// 打开，拖拽不可用' : '选不了 AppData？把文件夹直接拖进来'}</b>
          <span>
            {IS_FILE ? (
              <>
                浏览器在 <code>file://</code> 下不会给拖入的目录创建文件系统条目，表现为"拖了没反应"。请改用 <kbd>npm run dev</kbd> 起本地服务后拖拽，或直接导入快照 JSON。
              </>
            ) : (
              <>
                Chrome / Edge 会把 <code>AppData</code> 判定为系统目录，选择器直接拒绝（提示"此文件夹包含系统文件"）。<em>拖拽不受这个限制</em>：
                把 <code>…\CodeBuddyExtension\Data</code> 拖到窗口任意位置即可；想要会话标题与项目路径，再把 <code>codebuddy-sessions.vscdb</code> 一起拖进来。
                WorkBuddy 的 <code>~/.workbuddy</code> 一般可以直接选，也可以直接拖。
              </>
            )}
          </span>
          <span style={{ display: 'block', marginTop: 6, color: 'var(--ink-4)' }}>
            Chromium 系浏览器拖拽时会顺手给出目录句柄，因此拖完仍可用「重扫」拿最新用量；若某个环境没给句柄，页面会明确提示你把文件夹再拖一次。
          </span>
        </div>

        <div className="hint-grid">
          <div className="hint">
            <b>Windows</b>
            <span>
              资源管理器里显示隐藏目录：<kbd>Alt</kbd> → <kbd>V</kbd> → <kbd>H</kbd>；地址栏可直接粘贴上面的路径。
            </span>
          </div>
          <div className="hint">
            <b>macOS</b>
            <span>
              选择框内按 <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>.</kbd> 显示隐藏目录，<kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>G</kbd> 可粘贴路径直达。
            </span>
          </div>
          <div className="hint">
            <b>浏览器</b>
            <span>{supportsDirectory ? '当前浏览器支持目录选择，下次会记住位置，可一键重扫。' : '当前环境不支持目录 API，已回退为「选择文件夹」文件框。'}</span>
          </div>
        </div>
      </section>

      <div className="feature-strip">
        <div className="feature">
          <b>请求级真值</b>
          <span>直接读 <code>requests[].usage</code> 的 8 个字段，不做估算。</span>
        </div>
        <div className="feature">
          <b>缓存与积分效率</b>
          <span>按模型看命中率、每百万 token 的积分消耗。</span>
        </div>
        <div className="feature">
          <b>可携带快照</b>
          <span>一键导出 JSON（含两端来源），换机、归档、离线分享都不丢。</span>
        </div>
        <div className="feature">
          <b>自带数据体检</b>
          <span>逐源恒等式、重复记录、跨源合计一致性全部明示。</span>
        </div>
      </div>
    </div>
  )
}
