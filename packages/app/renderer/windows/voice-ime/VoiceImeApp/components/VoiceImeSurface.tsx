/** 浮层五态装配：录音、提示、取消、失败、结果。 */
import { useLatestCallback, useLatestRef } from 'hooks'
import { AnimatePresence, motion } from 'motion/react'
import { memo } from 'react'
import { cn } from 'utils'
import { VOICE_IME_RADIUS, VOICE_IME_SHADOW_INSET, VOICE_IME_WINDOW_SIZE } from '../constants'
import type { VoiceImeViewMode } from '../constants'
import { CanceledView } from './CanceledView'
import { FailureView } from './FailureView'
import { PromptView } from './PromptView'
import { RecordingView } from './RecordingView'
import { TranscriptionResult } from './TranscriptionResult'

export const VoiceImeSurface = memo<VoiceImeSurfaceProps>((props) => {
  const { viewMode, className, size, shadowInset, style, ...rest } = props
  const activeViewModeRef = useLatestRef(viewMode)
  const reportModeMeasure = useLatestCallback((mode: VoiceImeViewMode, width: number) => {
    if (activeViewModeRef.current !== mode) return
    rest.onMeasure?.(width)
  })
  const reportRecordingMeasure = useLatestCallback((width: number) => reportModeMeasure('recording', width))
  const reportCanceledMeasure = useLatestCallback((width: number) => reportModeMeasure('canceled', width))
  const reportFailureMeasure = useLatestCallback((width: number) => reportModeMeasure('failure', width))
  const resolvedShadowInset = size
    ? shadowInset ?? VOICE_IME_SHADOW_INSET
    : 0
  const fallbackSize = VOICE_IME_WINDOW_SIZE[viewMode]
  const viewportSize = size ?? fallbackSize
  const contentSize = size
    ? {
      width: Math.max(0, viewportSize.width - resolvedShadowInset * 2),
      height: Math.max(0, viewportSize.height - resolvedShadowInset * 2),
    }
    : undefined

  return (
    <div
      className="size-full"
      style={ { padding: resolvedShadowInset } }
    >
      <motion.div
        className={ cn(
          'relative h-full w-full overflow-hidden bg-background text-text shadow-[0_5px_20px_rgba(0,0,0,0.1),inset_0_0_0_1px_rgba(0,0,0,0.1)]',
          className,
        ) }
        style={ { borderRadius: VOICE_IME_RADIUS[viewMode], ...style } }
        animate={ contentSize ?? { width: '100%', height: '100%' } }
        transition={ { type: 'spring', stiffness: 400, damping: 35 } }
      >
        <AnimatePresence mode="wait">
          { viewMode === 'recording' && (
            <RecordingView
              key="recording"
              durationLabel={ rest.durationLabel }
              remainingSeconds={ rest.remainingSeconds }
              isProcessing={ rest.isProcessing }
              audioLevel={ rest.audioLevel }
              onMeasure={ reportRecordingMeasure }
              onCancel={ rest.onCancel ?? (() => {}) }
              onStop={ rest.onStop ?? (() => {}) }
            />
          ) }
          { viewMode === 'prompt' && <PromptView key="prompt" { ...rest } /> }
          { viewMode === 'canceled' && (
            <CanceledView
              key="canceled"
              expiresAt={ rest.expiresAt ?? null }
              onUndo={ rest.onUndo ?? (() => {}) }
              onDismiss={ rest.onDismiss ?? (() => {}) }
              onMeasure={ reportCanceledMeasure }
            />
          ) }
          { viewMode === 'failure' && (
            <FailureView
              key="failure"
              message={ rest.message ?? 'Unable to complete voice input' }
              detail={ rest.detail }
              onRetry={ rest.onRetry }
              onDismiss={ rest.onDismiss }
              onShowDetail={ rest.onShowDetail }
              onMeasure={ reportFailureMeasure }
            />
          ) }
          { viewMode === 'result' && (
            <TranscriptionResult
              key="result"
              text={ rest.text ?? '' }
              sourceHost={ rest.sourceHost }
              onCopy={ rest.onCopy }
              onDismiss={ rest.onDismiss }
            />
          ) }
        </AnimatePresence>
      </motion.div>
    </div>
  )
})

VoiceImeSurface.displayName = 'VoiceImeSurface'

export type VoiceImeSurfaceProps = {
  viewMode: VoiceImeViewMode
  durationLabel?: string
  audioLevel?: number
  remainingSeconds?: number | null
  isProcessing?: boolean
  text?: string
  message?: string
  detail?: string
  sourceHost?: string
  onCopy?: (text: string) => void | Promise<void>
  expiresAt?: number | null
  onMeasure?: (width: number) => void
  onStart?: () => void
  onCancel?: () => void
  onStop?: () => void
  onUndo?: () => void
  onRetry?: () => void
  onDismiss?: () => void
  onShowDetail?: () => void
  /** 含透明阴影留白的完整窗口尺寸；传入后启用窗口内层的尺寸动画。 */
  size?: { width: number; height: number }
  /** 可见表面与透明窗口边缘之间的单侧留白。 */
  shadowInset?: number
  className?: string
  style?: React.CSSProperties
}
