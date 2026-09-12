/** 取消后的短时撤销条。 */
import { RotateCcw, X } from 'lucide-react'
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cn } from 'utils'
import { VOICE_UNDO_WINDOW_MS } from '../constants'

export const CanceledView = memo<CanceledViewProps>((props) => {
  const { expiresAt, onUndo, onDismiss, onMeasure, className } = props
  const [now, setNow] = useState(() => Date.now())
  const contentRef = useRef<HTMLDivElement | null>(null)
  const remainingMs = expiresAt === null
    ? null
    : Math.max(0, expiresAt - now)
  const seconds = remainingMs === null
    ? 0
    : Math.ceil(remainingMs / 1000)
  const progress = remainingMs === null
    ? 1
    : remainingMs / VOICE_UNDO_WINDOW_MS

  useEffect(() => {
    if (expiresAt === null) return
    const timer = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(timer)
  }, [expiresAt])

  useLayoutEffect(() => {
    if (!onMeasure || !contentRef.current) return
    onMeasure(Math.max(200, Math.ceil(contentRef.current.scrollWidth) + 32))
  }, [onMeasure, seconds])

  return (
    <div
      className={ cn(
        'relative flex size-full items-center overflow-hidden rounded-full px-4',
        className,
      ) }
    >
      <span
        className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 origin-left bg-info"
        style={ { transform: `scaleX(${progress})` } }
        aria-hidden="true"
      />
      <div ref={ contentRef } className="flex w-max items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <RotateCcw className="size-4 shrink-0 text-warning" aria-hidden="true" />
          <span className="truncate text-xs text-text">Canceled</span>
          { seconds > 0 && <span className="shrink-0 text-xs tabular-nums text-text3">{ seconds }s</span> }
        </div>
        <button
          type="button"
          aria-label="Undo"
          disabled={ remainingMs !== null && remainingMs <= 0 }
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-text px-2.5 py-1.5 text-xs text-textSpecial transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text3/40 disabled:pointer-events-none disabled:opacity-40"
          onClick={ onUndo }
        >
          Undo
        </button>
        <button type="button" aria-label="Dismiss" className="grid size-7 shrink-0 place-items-center rounded-lg text-text3 transition-colors hover:bg-background2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text3/40" onClick={ onDismiss }>
          <X className="size-4" />
        </button>
      </div>
    </div>
  )
})

CanceledView.displayName = 'CanceledView'

export type CanceledViewProps = {
  expiresAt: number | null
  onUndo: () => void
  onDismiss: () => void
  onMeasure?: (width: number) => void
  className?: string
}
