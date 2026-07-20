import type { SelectionRect } from '../types'
import { useFloatingPosition, useLatestCallback } from 'hooks'
import { Check, Download, X } from 'lucide-react'
import { memo, useEffect, useRef } from 'react'
import { cn } from 'utils'
import { TOOLBAR_GAP } from '../constants'

/**
 * 选区操作工具栏
 *
 * 定位交给 useFloatingPosition 的虚拟锚点模式：选区不是 DOM 元素，
 * 用 getVirtualReferenceRect 把它当锚点，flip 负责下方放不下时翻到上方，
 * shift 负责贴边钳制。浮层尺寸由 hook 实测，改按钮数量/内边距不必同步常量
 */
export const ScreenshotToolbar = memo<ScreenshotToolbarProps>(({
  selection,
  onConfirm,
  onSave,
  onCancel,
}) => {
  const floatingRef = useRef<HTMLDivElement>(null)
  /**
   * 锚点是选区矩形而非 DOM 节点，但 referenceRef 进了 hook 内部的依赖数组，
   * 必须给一个引用稳定的空 ref —— 内联 { current: null } 每帧都是新对象，
   * 会让 resize 监听反复解绑重绑
   */
  const referenceRef = useRef<HTMLElement>(null)

  const getSelectionRect = useLatestCallback(() => new DOMRect(
    selection.x,
    selection.y,
    selection.width,
    selection.height,
  ))

  const { style, update } = useFloatingPosition(
    referenceRef,
    floatingRef,
    {
      placement: 'bottom-end',
      offset: TOOLBAR_GAP,
      boundaryPadding: TOOLBAR_GAP,
      getVirtualReferenceRect: getSelectionRect,
      /** overlay 铺满视口且不滚动，scroll 监听无意义，省掉一组全局监听 */
      autoUpdate: false,
    },
  )

  /** 选区随拖拽/缩放实时变化，每次变更都要重算浮层位置 */
  useEffect(update, [selection.x, selection.y, selection.width, selection.height, update])

  return (
    <div
      ref={ floatingRef }
      className={ cn(
        'z-toast flex items-center gap-2',
        'px-3 py-1 rounded-xl',
        'bg-text shadow-[0_8px_24px_rgba(0,0,0,0.15)]',
      ) }
      style={ style }
      onMouseDown={ e => e.stopPropagation() }
    >
      <ToolbarButton onClick={ onCancel } label="取消">
        <X className="size-5" />
      </ToolbarButton>

      <ToolbarButton onClick={ onSave } label="保存">
        <Download className="size-5" />
      </ToolbarButton>

      <ToolbarButton onClick={ onConfirm } label="确定">
        <Check className="size-5" />
      </ToolbarButton>
    </div>
  )
})

ScreenshotToolbar.displayName = 'ScreenshotToolbar'

const ToolbarButton = memo<ToolbarButtonProps>(({ children, onClick, label }) => {
  return (
    <button
      type="button"
      title={ label }
      onClick={ onClick }
      className={ cn(
        'flex items-center justify-center p-1.5 rounded-[10px]',
        'text-textSpecial transition-colors',
        'hover:bg-textSpecial/10 active:bg-textSpecial/20',
      ) }
    >
      {children}
    </button>
  )
})

ToolbarButton.displayName = 'ToolbarButton'

export type ScreenshotToolbarProps = {
  selection: SelectionRect
  onConfirm: () => void
  onSave: () => void
  onCancel: () => void
}

type ToolbarButtonProps = {
  children: React.ReactNode
  onClick: () => void
  label: string
}
