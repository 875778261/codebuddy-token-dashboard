import { useGSAP } from '@gsap/react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useEffect, useRef, type RefObject } from 'react'

gsap.registerPlugin(useGSAP, ScrollTrigger)

/** 只在用户没有要求「减少动效」时注册动画 */
export const MOTION_OK = '(prefers-reduced-motion: no-preference)'

/** 全局统一曲线：收尾快、不拖沓，多卡片同时入场也不会显得迟钝 */
export const EASE = 'power3.out'

export const isReducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

const ROW_SELECTOR = [
  '.mlist .mrow',
  '.plist .prow',
  '.dist .dist-row',
  'table.sessions tbody tr',
  '.cmp-table tbody tr',
  '.checks .check',
  '.health-list li',
  '.src-blocks .src-block',
].join(', ')

/**
 * 卡片内部的「值层」动画：条形从左侧生长、热力格浮现、列表逐行升起、迷你折线描边。
 * 只动 transform / opacity，不碰布局属性。
 */
function revealCardInner(card: HTMLElement) {
  const rows = card.querySelectorAll<HTMLElement>(ROW_SELECTOR)
  if (rows.length) {
    gsap.from(rows, { autoAlpha: 0, y: 10, duration: 0.45, ease: EASE, stagger: 0.022 })
  }

  const bars = card.querySelectorAll<HTMLElement>('.bar > span, .cmp-bar > i')
  if (bars.length) {
    gsap.fromTo(
      bars,
      { scaleX: 0 },
      { scaleX: 1, duration: 0.9, ease: EASE, stagger: 0.06, transformOrigin: 'left center' },
    )
  }

  const cells = card.querySelectorAll<HTMLElement>('.heat .hcell')
  if (cells.length) {
    gsap.from(cells, {
      autoAlpha: 0,
      scale: 0.35,
      duration: 0.5,
      ease: 'back.out(1.6)',
      stagger: { each: 0.004, from: 'start', grid: 'auto' },
    })
  }

  const strips = card.querySelectorAll<HTMLElement>('.cmp-days-strip .cmp-day, .coverage-strip i')
  if (strips.length) {
    gsap.from(strips, {
      autoAlpha: 0,
      scaleY: 0.1,
      duration: 0.45,
      ease: EASE,
      stagger: 0.008,
      transformOrigin: 'center bottom',
    })
  }

  card.querySelectorAll<SVGPathElement>('.sparkline path').forEach((path) => {
    if (!path.getAttribute('stroke')) return
    const len = path.getTotalLength() || 1
    gsap.fromTo(
      path,
      { strokeDasharray: len, strokeDashoffset: len },
      { strokeDashoffset: 0, duration: 1.1, ease: 'power2.out' },
    )
  })
}

/**
 * 仪表盘入场：卡片按滚动位置分批浮起，进入视口的卡片同时触发内部值层动画。
 * once: true —— 只演一次，后续切窗口/换主题不再重播。
 */
export function useDashboardReveal(scope: RefObject<HTMLElement | null>, active: boolean) {
  useGSAP(
    () => {
      const root = scope.current
      if (!root) return

      const cards = gsap.utils.toArray<HTMLElement>('.card, .kpi', root)
      if (!cards.length) return
      const banners = gsap.utils.toArray<HTMLElement>('.banner', root)

      const mm = gsap.matchMedia()

      mm.add(MOTION_OK, () => {
        if (banners.length) {
          gsap.from(banners, { autoAlpha: 0, y: -8, duration: 0.5, ease: EASE, stagger: 0.05 })
        }

        gsap.set(cards, { autoAlpha: 0, y: 26, scale: 0.988 })

        ScrollTrigger.batch(cards, {
          start: 'top bottom-=32',
          once: true,
          batchMax: 8,
          onEnter: (batch) => {
            batch.forEach((el) => revealCardInner(el as HTMLElement))
            gsap.to(batch, {
              autoAlpha: 1,
              y: 0,
              scale: 1,
              duration: 0.62,
              ease: EASE,
              stagger: 0.07,
              overwrite: true,
            })
          },
        })

        // 兜底：万一触发器因布局异常没被激活，首屏内容也不能真的消失
        const rescue = window.setTimeout(() => {
          const limit = window.innerHeight
          cards.forEach((el) => {
            if (el.getBoundingClientRect().top < limit && Number(gsap.getProperty(el, 'opacity')) === 0) {
              gsap.to(el, { autoAlpha: 1, y: 0, scale: 1, duration: 0.3, overwrite: true })
            }
          })
        }, 2200)

        return () => window.clearTimeout(rescue)
      })
    },
    { scope, dependencies: [active], revertOnUpdate: true },
  )
}

/** 数据或窗口变化后，卡片高度会变：重算一次触发器位置 */
export function useScrollRefresh(deps: unknown[]) {
  useEffect(() => {
    const timer = window.setTimeout(() => ScrollTrigger.refresh(), 200)
    return () => window.clearTimeout(timer)
  }, deps)
}

/** 顶部细进度条：跟手滚动，纯 scaleX，不引起重排 */
export function useScrollProgress(ref: RefObject<HTMLElement | null>) {
  useGSAP(() => {
    const bar = ref.current
    if (!bar) return
    const mm = gsap.matchMedia()
    mm.add(MOTION_OK, () => {
      gsap.fromTo(
        bar,
        { scaleX: 0 },
        {
          scaleX: 1,
          ease: 'none',
          scrollTrigger: { start: 0, end: 'max', scrub: 0.3, invalidateOnRefresh: true },
        },
      )
    })
  }, [])
}

/** 顶栏入场 + 品牌标记弹入 */
export function useTopbarIntro(ref: RefObject<HTMLElement | null>) {
  useGSAP(
    () => {
      const el = ref.current
      if (!el) return
      const mm = gsap.matchMedia()
      mm.add(MOTION_OK, () => {
        gsap.from(el, { y: -16, autoAlpha: 0, duration: 0.55, ease: EASE })
        const mark = el.querySelector('.brand-mark')
        if (mark) {
          gsap.from(mark, { scale: 0.4, rotate: -28, autoAlpha: 0, duration: 0.75, delay: 0.08, ease: 'back.out(1.8)' })
        }
      })
    },
    { scope: ref },
  )
}

/** 主题按钮：切换时翻个身，避免"点下去没反应" */
export function useThemeIconFlip(ref: RefObject<HTMLElement | null>, theme: string) {
  const first = useRef(true)
  useGSAP(
    () => {
      const el = ref.current
      if (!el) return
      if (first.current) {
        first.current = false
        return
      }
      if (isReducedMotion()) return
      gsap.fromTo(el, { rotate: -140, scale: 0.6 }, { rotate: 0, scale: 1, duration: 0.55, ease: 'back.out(2)' })
    },
    { dependencies: [theme], scope: ref },
  )
}
