import type { ScreenshotBounds } from '@shared'
import { Check, Download, X } from 'lucide-react'
import { memo } from 'react'
import { cn } from 'utils'

const TOOLBAR_HEIGHT = 40
const TOOLBAR_GAP = 8

export const ScreenshotToolbar = memo<ScreenshotToolbarProps>(({
  selection,
  onConfirm,
  onSave,
  onCancel,
}) => {
  const top = selection.y + selection.height + TOOLBAR_GAP
  const maxTop = window.innerHeight - TOOLBAR_HEIGHT - TOOLBAR_GAP
  const adjustedTop = top > maxTop
    ? selection.y - TOOLBAR_HEIGHT - TOOLBAR_GAP
    : top

  return (
    <div
      className={ cn(
        'fixed z-50 flex items-center gap-1',
        'rounded-lg px-1.5 py-1',
        'bg-black/70 backdrop-blur-xl',
        'shadow-lg shadow-black/20',
      ) }
      style={ {
        left: selection.x + selection.width - 120,
        top: adjustedTop,
      } }
      onMouseDown={ e => e.stopPropagation() }
    >
      <ToolbarButton
        onClick={ onCancel }
        label="取消"
      >
        <X className="size-4" />
      </ToolbarButton>

      <div className="w-px h-5 bg-white/10" />

      <ToolbarButton
        onClick={ onSave }
        label="保存"
      >
        <Download className="size-4" />
      </ToolbarButton>

      <ToolbarButton
        onClick={ onConfirm }
        label="确定"
        accent
      >
        <Check className="size-4" />
      </ToolbarButton>
    </div>
  )
})

ScreenshotToolbar.displayName = 'ScreenshotToolbar'

const ToolbarButton = memo<ToolbarButtonProps>(({
  children,
  onClick,
  label,
  accent,
}) => {
  return (
    <button
      type="button"
      title={ label }
      onClick={ onClick }
      className={ cn(
        'flex items-center justify-center',
        'size-8 rounded-md transition-colors',
        accent
          ? 'bg-blue-500 text-white hover:bg-blue-400'
          : 'text-white/80 hover:bg-white/10 hover:text-white',
      ) }
    >
      {children}
    </button>
  )
})

ToolbarButton.displayName = 'ToolbarButton'

export type ScreenshotToolbarProps = {
  selection: ScreenshotBounds
  onConfirm: () => void
  onSave: () => void
  onCancel: () => void
}

type ToolbarButtonProps = {
  children: React.ReactNode
  onClick: () => void
  label: string
  accent?: boolean
}
