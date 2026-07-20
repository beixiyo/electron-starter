import { memo } from 'react'
import { cn } from 'utils'

const LABEL_OFFSET = 26

/**
 * 选区尺寸提示
 *
 * 乘 scaleFactor 换算成物理像素，与主进程的裁剪口径对齐
 */
export const SizeIndicator = memo<SizeIndicatorProps>(({
  x,
  y,
  width,
  height,
  scaleFactor,
}) => {
  return (
    <div
      className={ cn(
        'fixed pointer-events-none',
        'text-xs text-textSpecial',
        'bg-text/60 backdrop-blur-sm',
        'px-2 py-0.5 rounded-md',
      ) }
      style={ {
        left: x,
        top: Math.max(0, y - LABEL_OFFSET),
      } }
    >
      {Math.round(width * scaleFactor)}
      {' x '}
      {Math.round(height * scaleFactor)}
    </div>
  )
})

SizeIndicator.displayName = 'SizeIndicator'

export type SizeIndicatorProps = {
  /** 选区左上角，标签贴其上方 */
  x: number
  y: number
  width: number
  height: number
  /** 当前屏缩放比，用于把 CSS 像素换算成物理像素 */
  scaleFactor: number
}
