import { useGSAP } from '@gsap/react'
import { gsap } from 'gsap'
import { useRef } from 'react'
import { IS_FILE, PathList } from './importPaths'
import { EASE, MOTION_OK } from './motion'

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
  const ref = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      const root = ref.current
      if (!root) return
      const hero = root.querySelector('.hero')
      const blocks = root.querySelectorAll('.pathbox, .dropzone, .hint, .feature')
      const mm = gsap.matchMedia()
      mm.add(MOTION_OK, () => {
        if (hero) gsap.from(hero, { autoAlpha: 0, y: 22, duration: 0.62, ease: EASE })
        if (blocks.length) {
          gsap.from(blocks, { autoAlpha: 0, y: 14, duration: 0.5, ease: EASE, stagger: 0.05, delay: 0.1 })
        }
      })
    },
    { scope: ref },
  )

  return (
    <div className="landing" ref={ref}>
      <section className="hero">
        <h2>AI 用量总账，数据不出这台电脑</h2>
        <p>
          把 <b>CodeBuddy</b> 或 <b>WorkBuddy</b> 的文件夹<b>拖进窗口</b>。只给一个，就只看这一份；两个都给，就合成一份总账，
          并多出一块<b>端对比</b>（两边比一比）。
        </p>
        <p>
          统计 Token、积分、缓存命中、项目与会话分布。
        </p>
        <p className="privacy">
          <b>读取和统计都在你的浏览器里完成</b>：不上传，不写任何服务器；关掉页面就清空。
        </p>

        <PathList />
        <p style={{ fontSize: 11.5, color: 'var(--ink-4)', marginTop: 4 }}>
          可以分两次拖：后拖的只更新自己那一边。会话库只用来补 CodeBuddy 的标题和项目路径。
        </p>

        <div className="hero-actions">
          <button type="button" className="btn primary" onClick={supportsDirectory ? onPickDirectory : onPickFallback} disabled={busy}>
            {busy ? <span className="spin" /> : null}
            {busy ? '读取中…' : '选择文件夹'}
          </button>
          <button type="button" className="btn" onClick={onImport} disabled={busy}>
            导入快照
          </button>
          <button type="button" className="btn ghost" onClick={onDemo} disabled={busy}>
            先看示例
          </button>
        </div>

        {status ? <div className={`status-line${status.error ? ' error' : ''}`}>{status.text}</div> : null}

        <div className="dropzone">
          <b>{IS_FILE ? '这个页面是直接打开的（file://），拖不进来' : '选不了 AppData？把文件夹直接拖进来'}</b>
          <span>
            {IS_FILE ? (
              <>
                浏览器不认这种页面里拖进来的文件夹，表现就是"拖了没反应"。改用 <kbd>npm run dev</kbd> 起本地服务再拖，或者直接导入快照。
              </>
            ) : (
              <>
                Chrome / Edge 会把 <code>AppData</code> 当成系统目录，选择器直接拒绝（提示"此文件夹包含系统文件"）。<em>拖进来不受这个限制</em>：
                把 <code>…\CodeBuddyExtension\Data</code> 拖到窗口任意位置就行；想要标题和项目路径，再把 <code>codebuddy-sessions.vscdb</code> 一起拖。
                WorkBuddy 的 <code>~/.workbuddy</code> 一般能直接选，也能直接拖。
              </>
            )}
          </span>
          <span style={{ display: 'block', marginTop: 6, color: 'var(--ink-4)' }}>
            Chrome / Edge 拖完会记住这个文件夹，所以之后还能点「重扫」拿最新用量。万一没记住，页面会提示你再拖一次。
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
            <span>{supportsDirectory ? '这个浏览器能直接选文件夹，下次会记住位置，可以一键重扫。' : '这个浏览器不支持直接选文件夹，已改成用窗口选择。'}</span>
          </div>
        </div>
      </section>

      <div className="feature-strip">
        <div className="feature">
          <b>请求级真值</b>
          <span>直接读记录里的 8 个用量字段，不做估算。</span>
        </div>
        <div className="feature">
          <b>缓存与积分效率</b>
          <span>按模型看命中率、每百万 token 花多少积分。</span>
        </div>
        <div className="feature">
          <b>可携带快照</b>
          <span>一键导出 JSON（两端来源都在里面），换机、归档、离线分享都不丢。</span>
        </div>
        <div className="feature">
          <b>自带数据体检</b>
          <span>每份数据的加总、重复记录、合并后是否对得上，都写出来。</span>
        </div>
      </div>
    </div>
  )
}
