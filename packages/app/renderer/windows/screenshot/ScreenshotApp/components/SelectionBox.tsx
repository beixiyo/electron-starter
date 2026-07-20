import type { SelectionRect } from '../types'
import { memo } from 'react'

/**
 * 选区边框 + 区域外遮罩
 *
 * 遮罩用超大 boxShadow 向外扩散实现「挖洞」，省掉四块遮罩 div 的布局计算，
 * 也天然保证洞与边框像素级对齐
 *
 * boxShadow 无法用 Tailwind token 类表达，故直接引 --text 变量，
 * 与未选区时的 bg-text/40 保持同一来源
 */
export const SelectionBox = memo<SelectionBoxProps>(({ selection }) => {
  return (
    <div
      className="fixed border border-textSpecial/70 pointer-events-none"
      style={ {
        left: selection.x,
        top: selection.y,
        width: selection.width,
        height: selection.height,
        boxShadow: '0 0 0 9999px rgb(var(--text) / 0.4)',
      } }
    />
  )
})

SelectionBox.displayName = 'SelectionBox'

export type SelectionBoxProps = {
  selection: SelectionRect
}
