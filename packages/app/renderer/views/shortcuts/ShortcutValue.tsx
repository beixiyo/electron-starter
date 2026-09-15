import { formatBinding, SHORTCUT_KEY_SEPARATOR } from '@/utils/shortcutFormat'
import { SeamlessScroll } from 'comps'
import { useLatestCallback, useResizeObserver } from 'hooks'
import { memo, useLayoutEffect, useRef, useState } from 'react'
import { cn } from 'utils'
import type { ShortcutGestureBinding } from './types'

const MARQUEE_SPEED_PX_PER_SECOND = 16
const MARQUEE_GAP_PX = 24

/** 展示快捷键文本，溢出时只在悬停状态无缝滚动完整内容。 */
export const ShortcutValue = memo<ShortcutValueProps>((props) => {
  const { binding, placeholder, hovered, className } = props
  const viewportRef = useRef<HTMLSpanElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const [measured, setMeasured] = useState<Measurement | null>(null)
  const text = binding
    ? formatBinding(binding, { separator: SHORTCUT_KEY_SEPARATOR })
    : placeholder ?? ''

  const measure = useLatestCallback(() => {
    const element = textRef.current
    if (!element) return

    const overflow = element.scrollWidth > element.clientWidth
    setMeasured((previous) =>
      previous?.text === text && previous.overflow === overflow
        ? previous
        : { text, overflow }
    )
  })

  useLayoutEffect(measure, [measure, text])
  useResizeObserver([viewportRef], measure)

  const overflow = measured?.text === text && measured.overflow
  const marquee = !!hovered && overflow

  return (
    <span ref={ viewportRef } className={ cn('block overflow-hidden text-sm leading-5.5', className) }>
      { marquee
        ? (
          <SeamlessScroll speed={ MARQUEE_SPEED_PX_PER_SECOND } gap={ MARQUEE_GAP_PX } pauseOnHover={ false }>
            <span className="whitespace-nowrap">{ text }</span>
          </SeamlessScroll>
        )
        : <span ref={ textRef } className="block truncate">{ text }</span> }
    </span>
  )
})

ShortcutValue.displayName = 'ShortcutValue'

export type ShortcutValueProps = {
  binding: ShortcutGestureBinding | null
  /** 没有绑定时显示的占位文本。 */
  placeholder?: string
  /** 是否悬停在控件上。 */
  hovered?: boolean
  className?: string
}

type Measurement = {
  text: string
  overflow: boolean
}
