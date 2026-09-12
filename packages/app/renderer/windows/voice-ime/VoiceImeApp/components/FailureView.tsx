/** 失败视图：胶囊只显示状态，详情由宿主通过回调展示。 */
import { AlertTriangle, ChevronDown, RotateCcw, X } from 'lucide-react'
import { memo, useCallback, useLayoutEffect, useRef } from 'react'
import { cn } from 'utils'

export const FailureView = memo<FailureViewProps>((props) => {
  const { message, detail, canRetry = true, onRetry, onDismiss, onShowDetail, onMeasure, className } = props
  const contentRef = useRef<HTMLDivElement | null>(null)
  const measure = useCallback(() => {
    if (!contentRef.current || !onMeasure) return
    onMeasure(Math.max(200, Math.ceil(contentRef.current.scrollWidth) + 32))
  }, [onMeasure])

  useLayoutEffect(() => {
    measure()
  }, [message, detail, onShowDetail, measure])

  return (
    <div className={ cn('flex size-full items-center overflow-hidden rounded-xl px-4', className) }>
      <div ref={ contentRef } className="flex w-max items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
          <div className="min-w-0">
            <p className="truncate text-xs text-text">{ message }</p>
          </div>
          { detail && onShowDetail && (
            <button type="button" aria-label="Show details" className="grid size-7 shrink-0 place-items-center rounded-lg text-text3 transition-colors hover:bg-background2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text3/40" onClick={ onShowDetail }>
              <ChevronDown className="size-4" />
            </button>
          ) }
        </div>
        <div className="flex shrink-0 items-center gap-2">
          { onDismiss && (
            <button type="button" aria-label="Dismiss" className="grid size-7 shrink-0 place-items-center rounded-lg text-text3 transition-colors hover:bg-background2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text3/40" onClick={ onDismiss }>
              <X className="size-4" />
            </button>
          ) }
          { canRetry && onRetry && (
            <button type="button" className="inline-flex items-center gap-1.5 rounded-lg bg-text px-2.5 py-1.5 text-xs text-textSpecial transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text3/40" onClick={ onRetry }>
              <RotateCcw className="size-3.5" />Retry
            </button>
          ) }
        </div>
      </div>
    </div>
  )
})

FailureView.displayName = 'FailureView'

export type FailureViewProps = {
  message: string
  detail?: string
  canRetry?: boolean
  onRetry?: () => void
  onDismiss?: () => void
  onShowDetail?: () => void
  onMeasure?: (width: number) => void
  className?: string
}
