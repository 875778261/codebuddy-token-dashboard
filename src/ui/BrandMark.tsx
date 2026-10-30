import { useRef } from 'react'
import markUrl from '../assets/logo-mark.webp'
import { useBrandMotion } from './motion'

/**
 * 品牌标记（无文字版 logo）+ 三层动效。
 *
 * 三层节点是刻意的：shell 负责果冻缩放、magnet 负责磁吸位移与倾斜、image 负责滚动惯性，
 * 同一个元素上叠三种 transform 会互相 overwrite（见 motion.ts 的 useBrandMotion）。
 * 图片走 Vite 资源导入，构建时内联成 data URI，产物仍是单个 index.html。
 */
export function BrandMark({
  pulse = 0,
  variant = 'topbar',
}: {
  /** 变化即触发一次果冻脉冲；不传则只有交互动效 */
  pulse?: string | number
  variant?: 'topbar' | 'hero'
}) {
  const shell = useRef<HTMLSpanElement>(null)
  const magnet = useRef<HTMLSpanElement>(null)
  const image = useRef<HTMLImageElement>(null)
  useBrandMotion({ shell, magnet, image, pulse })

  return (
    <span className={variant === 'hero' ? 'brand-mark brand-mark-hero' : 'brand-mark'} ref={shell} aria-hidden="true">
      <span className="brand-mark-magnet" ref={magnet}>
        <img ref={image} src={markUrl} alt="" draggable={false} />
      </span>
    </span>
  )
}
