/** 浮层五态装配：录音、提示、取消、失败、结果。 */
import { useLatestCallback, useLatestRef } from 'hooks'
import { AnimatePresence } from 'motion/react'
import { memo } from 'react'
import { cn } from 'utils'
import { getVoiceImeShellRadius, VOICE_IME_SHADOW_INSET, VOICE_IME_WINDOW_SIZE } from '../constants'
import type { VoiceImeViewMode } from '../constants'
import { CanceledView } from './CanceledView'
import { FailureView } from './FailureView'
import { PromptView } from './PromptView'
import { RecordingView } from './RecordingView'
import { TranscriptionResult } from './TranscriptionResult'
import { VoiceImeShell } from './VoiceImeShell'

export const VoiceImeSurface = memo<VoiceImeSurfaceProps>((props) => {
  const { viewMode, className, size, shadowInset, style, shellRef, ...rest } = props
  const activeViewModeRef = useLatestRef(viewMode)
  const reportModeMeasure = useLatestCallback((mode: VoiceImeViewMode, width: number) => {
    if (activeViewModeRef.current !== mode) return
    rest.onMeasure?.(width)
  })
  const reportRecordingMeasure = useLatestCallback((width: number) => reportModeMeasure('recording', width))
  const reportCanceledMeasure = useLatestCallback((width: number) => reportModeMeasure('canceled', width))
  const reportFailureMeasure = useLatestCallback((width: number) => reportModeMeasure('failure', width))
  const resolvedShadowInset = shadowInset ?? VOICE_IME_SHADOW_INSET
  const targetSize = size ?? VOICE_IME_WINDOW_SIZE[viewMode]
  const contentWidth = Math.max(0, targetSize.width - resolvedShadowInset * 2)
  const contentHeight = Math.max(0, targetSize.height - resolvedShadowInset * 2)

  return (
    <VoiceImeShell
      ref={ shellRef }
      variant={ viewMode === 'result'
        ? 'card'
        : 'capsule' }
      width={ contentWidth }
      height={ contentHeight }
      radius={ getVoiceImeShellRadius(viewMode, contentHeight) }
      /**
       * 传了 `size` 就是在固定尺寸的透明窗里：壳锚在窗口底边正中，宽高一变就从这个点
       * 向上、向两侧长。窗口位置由主进程按「水平居中、底边贴屏」摆好且可见期间不 resize
       * （见 `useVoiceImeViewport`），底边正中就是所有形态共同的锚点，形变全程只有壳自己
       * 的一条弹簧，没有任何位移。不传 `size` 是内联预览 / 测试，壳留在文档流里
       */
      className={ cn(
        size && 'fixed inset-x-0 mx-auto',
        className,
      ) }
      style={ size
        ? { bottom: resolvedShadowInset, ...style }
        : style }
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
    </VoiceImeShell>
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
  /**
   * 壳要长到的尺寸，含透明阴影留白（即该形态的「窗口尺寸」）
   *
   * 传入即视为跑在固定尺寸的透明窗里，壳锚到窗口底边正中；不传则按形态默认值内联渲染
   */
  size?: { width: number; height: number }
  /** 壳与透明窗口底边之间的留白。 */
  shadowInset?: number
  /** 壳元素本体，宿主拿它算点击穿透的命中区 */
  shellRef?: React.Ref<HTMLDivElement>
  className?: string
  style?: React.CSSProperties
}
