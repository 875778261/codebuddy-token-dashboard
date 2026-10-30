import { useGSAP } from '@gsap/react'
import { gsap } from 'gsap'
import { useRef } from 'react'
import { MOTION_OK } from './motion'

/**
 * 背景氛围层：三团静止的极光，进场时整体淡入一次，之后不再动。
 *
 * ⚠️ 不要给这里的元素加常驻动画——GSAP `repeat: -1` 和 CSS keyframes 一样贵。
 * 实测（1440×900 / 120Hz / Windows，「GPU Engine 3D」按进程拆分，页面静置）：
 *
 *   漂移（GSAP 逐帧写 transform）→ msedge 54~60%
 *   漂移（CSS 合成动画）          → msedge 48~54%
 *   静止                          → msedge 6%
 *
 * 原因不在"谁在动"，而在于这三团铺满半个视口：只要背景有一帧变化，压在它上面的
 * 14 张 backdrop-filter 卡片的背景采样就全部作废、每帧重算，等于整屏每帧重合成。
 * 想要背景动，就得先砍掉卡片的背景模糊；本项目选了保留玻璃质感，所以背景保持静止。
 * 动效预算留给入场、数字滚动这类"面积小、或只在交互时发生"的地方。
 */
export function Aurora() {
  const ref = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add(MOTION_OK, () => {
        // 只做透明度入场：不碰 transform，避免给这几个大图层引入任何重绘
        gsap.from(ref.current, { autoAlpha: 0, duration: 1.1, ease: 'power2.out' })
      })
    },
    { scope: ref },
  )

  return (
    <div className="aurora" ref={ref} aria-hidden="true">
      <i className="blob b1" />
      <i className="blob b2" />
      <i className="blob b3" />
    </div>
  )
}
