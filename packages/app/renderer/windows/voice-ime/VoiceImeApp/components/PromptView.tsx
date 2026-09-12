/** 等待开始或被阻断时的浮层视图。 */
import { Mic } from 'lucide-react'
import { memo } from 'react'
import { cn } from 'utils'

export const PromptView = memo<PromptViewProps>((props) => {
  const { title = 'Ready', detail = 'Hold the shortcut to speak', onStart, onDismiss, className } = props

  return (
    <div className={ cn('flex size-full items-center gap-2.5 overflow-hidden px-4', className) }>
      <Mic className="size-4 shrink-0 text-text3" aria-hidden="true" />
      <div className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm leading-5 text-text">{ title }</span>
        <span className="block truncate text-[11px] leading-4 text-text3">{ detail }</span>
      </div>
      { (onStart || onDismiss) && (
        <div className="flex shrink-0 items-center gap-1">
          { onDismiss && <button type="button" className="rounded-lg px-2 py-1 text-xs text-text3 transition-colors hover:bg-background2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text3/40" onClick={ onDismiss }>Close</button> }
          { onStart && <button type="button" className="rounded-lg bg-text px-2 py-1 text-xs text-textSpecial transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text3/40" onClick={ onStart }>Start</button> }
        </div>
      ) }
    </div>
  )
})

PromptView.displayName = 'PromptView'

export type PromptViewProps = {
  title?: string
  detail?: string
  onStart?: () => void
  onDismiss?: () => void
  className?: string
}
