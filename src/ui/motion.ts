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

/** 磁吸的作用半径与幅度上限：调这三个数就能改"手感"，别在组件里写死 */
const MAGNET_RADIUS = 96
const MAGNET_PULL = 0.22
const MAGNET_MAX_SHIFT = 9
const MAGNET_MAX_TILT = 9

/**
 * 品牌标记的三层动效。三层各动一个节点，是为了互不 overwrite——同一个元素同时被
 * 缩放、平移、倾斜会把彼此的 tween 撞掉：
 *   shell  —— 果冻：悬停轻压、按下压扁、松手弹回、数据刷新整块弹一次（只写 scaleX/scaleY）
 *   magnet —— 磁吸：指针进入半径后朝指针倾斜，离开半径后弹性回弹（只写 x/y/rotate/scale）
 *   image  —— 滚动惯性：跟随滚动速度后仰与拉伸，停下后弹回（只写 y/skewY/scaleY）
 * 只碰 transform，不读布局；指针移动时用的是缓存矩形，不会每帧触发重排。
 * 减少动效时一个监听都不注册。
 */
export function useBrandMotion({
  shell,
  magnet,
  image,
  pulse,
}: {
  shell: RefObject<HTMLElement | null>
  magnet: RefObject<HTMLElement | null>
  image: RefObject<HTMLElement | null>
  pulse: string | number
}) {
  const firstPulse = useRef(true)

  useEffect(() => {
    const shellEl = shell.current
    const magnetEl = magnet.current
    const imgEl = image.current
    if (!shellEl || !magnetEl || !imgEl || isReducedMotion()) return

    /** 指针移动时不重算布局：矩形只在尺寸/滚动变化时刷新 */
    let rect = shellEl.getBoundingClientRect()
    const refresh = () => {
      rect = shellEl.getBoundingClientRect()
    }
    window.addEventListener('resize', refresh)
    window.addEventListener('scroll', refresh, { passive: true })

    let attracted = false
    /** 离开吸引范围：用 elastic 收尾，读起来像被松开而不是被打断 */
    const relax = () => {
      if (!attracted) return
      attracted = false
      gsap.to(magnetEl, {
        x: 0,
        y: 0,
        rotate: 0,
        scale: 1,
        duration: 1.4,
        ease: 'elastic.out(1, 0.3)',
        overwrite: 'auto',
      })
    }

    const onPointerMove = (e: PointerEvent) => {
      const dx = e.clientX - (rect.left + rect.width / 2)
      const dy = e.clientY - (rect.top + rect.height / 2)
      const dist = Math.hypot(dx, dy)
      if (dist > MAGNET_RADIUS) {
        relax()
        return
      }
      attracted = true
      const pull = 1 - dist / MAGNET_RADIUS
      gsap.to(magnetEl, {
        x: gsap.utils.clamp(-MAGNET_MAX_SHIFT, MAGNET_MAX_SHIFT, dx * MAGNET_PULL * pull),
        y: gsap.utils.clamp(-MAGNET_MAX_SHIFT, MAGNET_MAX_SHIFT, dy * MAGNET_PULL * pull),
        rotate: gsap.utils.clamp(-MAGNET_MAX_TILT, MAGNET_MAX_TILT, dx * 0.1 * pull),
        scale: 1 + 0.05 * pull,
        duration: 0.35,
        ease: 'power3.out',
        overwrite: 'auto',
      })
    }

    // 指针移出窗口时不会触发 pointermove，得单独复位，否则会停在倾斜状态
    const onPointerOut = () => relax()

    window.addEventListener('pointermove', onPointerMove, { passive: true })
    document.addEventListener('pointerleave', onPointerOut)

    const squash = (x: number, y: number, duration: number) =>
      gsap.to(shellEl, { scaleX: x, scaleY: y, duration, ease: 'power2.out', overwrite: true })
    const spring = (power = 0.32) =>
      gsap.to(shellEl, { scaleX: 1, scaleY: 1, duration: 1, ease: `elastic.out(1, ${power})`, overwrite: true })

    const onEnter = () => squash(1.06, 0.94, 0.16)
    const onDown = () => squash(1.16, 0.84, 0.12)
    const onUp = () => spring(0.32)

    shellEl.addEventListener('pointerenter', onEnter)
    shellEl.addEventListener('pointerdown', onDown)
    shellEl.addEventListener('pointerup', onUp)
    shellEl.addEventListener('pointerleave', onUp)

    // 滚动惯性：ScrollTrigger 只给速度，回弹交给 timeout 后的 elastic
    let settle: number | undefined
    const inertia = ScrollTrigger.create({
      start: 0,
      end: 'max',
      onUpdate: (self) => {
        const v = gsap.utils.clamp(-1800, 1800, self.getVelocity())
        gsap.to(imgEl, {
          y: gsap.utils.clamp(-8, 8, v / 220),
          skewY: v / -820,
          scaleY: 1 + Math.min(0.1, Math.abs(v) / 14000),
          duration: 0.35,
          ease: 'power2.out',
          overwrite: 'auto',
        })
        window.clearTimeout(settle)
        settle = window.setTimeout(() => {
          gsap.to(imgEl, { y: 0, skewY: 0, scaleY: 1, duration: 1.5, ease: 'elastic.out(1, 0.45)', overwrite: 'auto' })
        }, 140)
      },
    })

    return () => {
      window.removeEventListener('resize', refresh)
      window.removeEventListener('scroll', refresh)
      window.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerleave', onPointerOut)
      shellEl.removeEventListener('pointerenter', onEnter)
      shellEl.removeEventListener('pointerdown', onDown)
      shellEl.removeEventListener('pointerup', onUp)
      shellEl.removeEventListener('pointerleave', onUp)
      window.clearTimeout(settle)
      inertia.kill()
      gsap.killTweensOf([shellEl, magnetEl, imgEl])
    }
  }, [shell, magnet, image])

  // 数据刷新：整块弹一次。首帧不弹——顶栏入场已经让它 pop 过，叠起来会显得抖
  useGSAP(
    () => {
      const el = shell.current
      if (!el) return
      if (firstPulse.current) {
        firstPulse.current = false
        return
      }
      if (isReducedMotion()) return
      gsap.fromTo(
        el,
        { scaleX: 1.2, scaleY: 0.8 },
        { scaleX: 1, scaleY: 1, duration: 1.05, ease: 'elastic.out(1, 0.38)', overwrite: true },
      )
    },
    { dependencies: [pulse], scope: shell },
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
