/** 浮层五态装配：录音、提示、取消、失败、结果。 */
import { memo } from 'react'
import { cn } from 'utils'
import { VOICE_IME_RADIUS } from '../constants'
import type { VoiceImeViewMode } from '../constants'
import { CanceledView } from './CanceledView'
import { FailureView } from './FailureView'
import { PromptView } from './PromptView'
import { RecordingView } from './RecordingView'
import { TranscriptionResult } from './TranscriptionResult'

export const VoiceImeSurface = memo<VoiceImeSurfaceProps>((props) => {
  const { viewMode, className, ...rest } = props

  return (
    <div
      className={ cn(
        'relative h-full w-full overflow-hidden bg-background text-text shadow-[0_5px_20px_rgba(0,0,0,0.1),inset_0_0_0_1px_rgba(0,0,0,0.1)]',
        className,
      ) }
      style={ { borderRadius: VOICE_IME_RADIUS[viewMode], ...rest.style } }
    >
      { viewMode === 'recording' && (
        <RecordingView
          durationLabel={ rest.durationLabel }
          remainingSeconds={ rest.remainingSeconds }
          isProcessing={ rest.isProcessing }
          audioLevel={ rest.audioLevel }
          onMeasure={ rest.onMeasure }
          onCancel={ rest.onCancel ?? (() => {}) }
          onStop={ rest.onStop ?? (() => {}) }
        />
      ) }
      { viewMode === 'prompt' && <PromptView { ...rest } /> }
      { viewMode === 'canceled' && (
        <CanceledView
          expiresAt={ rest.expiresAt ?? null }
          onUndo={ rest.onUndo ?? (() => {}) }
          onDismiss={ rest.onDismiss ?? (() => {}) }
          onMeasure={ rest.onMeasure }
        />
      ) }
      { viewMode === 'failure' && (
        <FailureView
          message={ rest.message ?? 'Unable to complete voice input' }
          detail={ rest.detail }
          onRetry={ rest.onRetry }
          onDismiss={ rest.onDismiss }
          onShowDetail={ rest.onShowDetail }
          onMeasure={ rest.onMeasure }
        />
      ) }
      { viewMode === 'result' && (
        <TranscriptionResult
          text={ rest.text ?? '' }
          sourceHost={ rest.sourceHost }
          onCopy={ rest.onCopy }
          onDismiss={ rest.onDismiss }
        />
      ) }
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
  className?: string
  style?: React.CSSProperties
}
