/** 录音中的浮层视图。 */
import { useLatestCallback } from 'hooks'
import { Mic } from 'lucide-react'
import { motion, useIsPresent } from 'motion/react'
import { memo, useLayoutEffect, useRef } from 'react'
import { cn } from 'utils'

export const RecordingView = memo<RecordingViewProps>((props) => {
  const { durationLabel = 'Listening', remainingSeconds = null, isProcessing = false, onMeasure, className } = props
  const contentRef = useRef<HTMLDivElement | null>(null)
  const isPresent = useIsPresent()
  const label = isProcessing
    ? 'Processing'
    : durationLabel
  const measure = useLatestCallback(() => {
    const content = contentRef.current
    if (!content || !onMeasure) return
    onMeasure(Math.ceil(content.scrollWidth) + 56)
  })

  const setContentRef = useLatestCallback((node: HTMLDivElement | null) => {
    contentRef.current = node
    measure()
  })

  useLayoutEffect(() => {
    if (!isPresent) return
    measure()
  }, [isPresent, label, remainingSeconds, measure])

  return (
    <motion.div
      initial={ { opacity: 0, y: 4 } }
      animate={ { opacity: 1, y: 0 } }
      exit={ { opacity: 0, y: -4 } }
      transition={ { duration: 0.16 } }
      className={ cn('relative flex size-full items-center justify-center overflow-hidden rounded-full', className) }
    >
      <div ref={ setContentRef } className="flex items-center gap-2 whitespace-nowrap text-sm font-medium text-text2/70">
        <Mic className="size-4 shrink-0 text-text2/50" aria-hidden="true" />
        <span>{ label }</span>
        { remainingSeconds !== null && !isProcessing && <span className="tabular-nums text-text2/70">{ remainingSeconds }s</span> }
      </div>
    </motion.div>
  )
})

RecordingView.displayName = 'RecordingView'

export type RecordingViewProps = {
  durationLabel?: string
  remainingSeconds?: number | null
  isProcessing?: boolean
  onMeasure?: (width: number) => void
  /** Compatibility for embedded callers that still provide a live level. */
  audioLevel?: number
  onCancel?: () => void
  onStop?: () => void
  className?: string
}
