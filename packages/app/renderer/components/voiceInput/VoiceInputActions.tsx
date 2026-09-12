/** 嵌入宿主使用的录音操作条；具体文案和动作由宿主注入。 */
import { Check, Loader2, X } from 'lucide-react'
import { memo } from 'react'
import { cn } from 'utils'
import type { VoiceInputPhase } from './types'

export const VoiceInputActions = memo<VoiceInputActionsProps>((props) => {
  const { phase, onCancel, onStop, recordingLabel = 'Listening', processingLabel = 'Processing' } = props
  const recording = phase === 'recording'
  const label = recording
    ? recordingLabel
    : processingLabel

  if (phase !== 'recording' && phase !== 'processing') return null

  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          aria-label="Cancel"
          className="grid size-8 shrink-0 place-items-center rounded-full bg-background2 text-text transition-colors hover:bg-background3"
          onClick={ onCancel }
        >
          <X className="size-4" />
        </button>
        <span className="truncate text-sm text-text3">{ label }</span>
      </div>
      { recording
        ? (
          <button
            type="button"
            aria-label="Finish"
            className={ cn('grid size-8 shrink-0 place-items-center rounded-full bg-text text-textSpecial transition-opacity hover:opacity-85') }
            onClick={ onStop }
          >
            <Check className="size-4" />
          </button>
        )
        : (
          <span role="status" aria-label={ processingLabel } className="grid size-8 shrink-0 place-items-center text-text3">
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
          </span>
        ) }
    </div>
  )
})

VoiceInputActions.displayName = 'VoiceInputActions'

export type VoiceInputActionsProps = {
  phase: Extract<VoiceInputPhase, 'recording' | 'processing'>
  onCancel: () => void | Promise<void>
  onStop: () => void | Promise<void>
  recordingLabel?: string
  processingLabel?: string
}
