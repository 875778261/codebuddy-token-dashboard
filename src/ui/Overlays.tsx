import { useGSAP } from '@gsap/react'
import { gsap } from 'gsap'
import { useRef } from 'react'
import { EASE, MOTION_OK, isReducedMotion } from './motion'

/** 仪表盘里的即时反馈：从底部弹起，不抢视线 */
export function Toast({ text, busy }: { text: string; busy: boolean }) {
  const ref = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      const el = ref.current
      if (!el || isReducedMotion()) return
      gsap.fromTo(
        el,
        { autoAlpha: 0, y: 16, scale: 0.96 },
        { autoAlpha: 1, y: 0, scale: 1, duration: 0.42, ease: EASE },
      )
    },
    { dependencies: [text], scope: ref },
  )

  return (
    <div className="toast-stack" aria-live="polite">
      <div className="toast" ref={ref}>
        {busy ? <span className="spin" /> : null}
        <span>{text}</span>
      </div>
    </div>
  )
}

/** 拖拽悬浮层：卡片放大浮现 + 图标呼吸，明确告诉用户「松手就行」 */
export function DropOverlay() {
  const ref = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      const root = ref.current
      if (!root) return
      const card = root.querySelector('.drop-card')
      const icon = root.querySelector('.drop-icon')
      if (!card || !icon) return
      const mm = gsap.matchMedia()
      mm.add(MOTION_OK, () => {
        gsap.from(root, { autoAlpha: 0, duration: 0.2, ease: 'none' })
        gsap.from(card, { autoAlpha: 0, y: 18, scale: 0.94, duration: 0.42, ease: 'back.out(1.4)' })
        gsap.to(icon, { y: -6, repeat: -1, yoyo: true, duration: 0.9, ease: 'sine.inOut' })
      })
    },
    { scope: ref },
  )

  return (
    <div className="drop-overlay" ref={ref}>
      <div className="drop-card">
        <div className="drop-icon">↓</div>
        <b>松手即读取</b>
        <span>
          支持 <code>CodeBuddyExtension\Data</code>、<code>~/.workbuddy</code>（或其 <code>projects</code>）、
          <code>codebuddy-sessions.vscdb</code>，或快照 JSON
          <br />
          两端可以分两次拖：后拖的只更新自己那一端
        </span>
      </div>
    </div>
  )
}
