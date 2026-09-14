/** 窗口级宿主登记可写焦点，承接录音操作、撤销提示和无输入焦点时的结果。 */
import { useVoiceImeEscapeShield } from '@/hooks/useVoiceImeEscapeShield'
import { isElectron } from '@/utils/env'
import { WINDOW_DATA_ATTR } from '@/windows/shared/dataAttributes'
import { RecordingView } from '@/windows/voice-ime/VoiceImeApp/components/RecordingView'
import { TranscriptionResult } from '@/windows/voice-ime/VoiceImeApp/components/TranscriptionResult'
import { VoiceImeShell } from '@/windows/voice-ime/VoiceImeApp/components/VoiceImeShell'
import { getVoiceImeShellRadius, VOICE_IME_CONTENT_SIZE } from '@/windows/voice-ime/VoiceImeApp/constants'
import { useLatestCallback, useLatestRef } from 'hooks'
import { AnimatePresence } from 'motion/react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from 'utils'
import { createMediaRecorderCapture } from './mediaRecorderCapture'
import type { VoiceCaptureAdapter, VoiceTranscribeAdapter } from './types'
import { useGlobalToastNotice } from './useGlobalToastNotice'
import { useVoiceSession } from './useVoiceSession'
import { VoiceSessionNotice } from './VoiceSessionNotice'

/** 胶囊量出真实宽度之前那一帧的兜底：带两颗按钮的胶囊比浮层的宽一截 */
const CAPSULE_FALLBACK_WIDTH = 256

export const VoiceImeWindowHost = memo<VoiceImeWindowHostProps>((props) => {
  const { active = true, editable = true, capture: injectedCapture, transcribe, onTranscription, onPrompt, onError, children, className, ...rest } = props
  const elementRef = useRef<HTMLDivElement | null>(null)
  const capture = useMemo(() => injectedCapture ?? createMediaRecorderCapture(), [injectedCapture])
  const session = useVoiceSession({ host: 'window', active, capture, transcribe, onTranscription, onPrompt, onError })
  useGlobalToastNotice(active)
  useVoiceImeEscapeShield()

  const updateFocus = useLatestCallback(() => {
    if (!isElectron()) return
    let focused = document.activeElement
    while (focused instanceof HTMLElement && focused.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement
    const inside = Boolean(active && focused && elementRef.current?.contains(focused))
    const inputHost = inside
      ? focused?.closest<HTMLElement>(`[${WINDOW_DATA_ATTR.voiceInputHost}][${WINDOW_DATA_ATTR.voiceInputSurface}="embedded"]`)
      : null
    const embeddedHost = inputHost?.getAttribute(WINDOW_DATA_ATTR.voiceInputHost)
    void $ipc.voiceIme.setFocusContext({
      editable: inside && editable && isWritableElement(focused),
      ...(embeddedHost
        ? { embeddedHost }
        : {}),
    }).catch(onError)
  })
  useEffect(() => {
    window.addEventListener('focusin', updateFocus, true)
    window.addEventListener('focusout', updateFocus, true)
    updateFocus()
    return () => {
      window.removeEventListener('focusin', updateFocus, true)
      window.removeEventListener('focusout', updateFocus, true)
      if (isElectron()) void $ipc.voiceIme.setFocusContext({ editable: false }).catch(() => {})
    }
  }, [active, editable, updateFocus])

  /**
   * 胶囊与结果卡共用一个壳（与浮层同一个 `VoiceImeShell`），从窗口底边正中长开
   *
   * 之前两者各是一个 fixed 容器、各自出现消失，转写完成那一下是胶囊消失、卡片凭空出现
   * 现在壳常驻，形态一换就从胶囊长成卡片；壳只在收场时淡出，出场直接到位（理由见壳上的注释）
   */
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null)
  /** 上一次渲染交给壳的实测宽度（读到的是上一轮提交的值），首次量出宽度那一次渲染据此直接落位 */
  const lastMeasuredWidthRef = useLatestRef(measuredWidth)
  const capsulePhase = session.phase === 'recording' || session.phase === 'processing'
    ? session.phase
    : null
  const cardVisible = !capsulePhase && Boolean(session.text)
  const shellVisible = Boolean(capsulePhase) || cardVisible
  const shellSize = capsulePhase
    ? { width: measuredWidth ?? CAPSULE_FALLBACK_WIDTH, height: VOICE_IME_CONTENT_SIZE.recording.height }
    : VOICE_IME_CONTENT_SIZE.result
  const shellMode = capsulePhase
    ? 'recording' as const
    : 'result' as const

  /**
   * 壳挂上后第一次量到的宽度直接落位，不从兜底宽度弹过去
   *
   * 兜底 256 比 Listening 那一档宽一大截（按 `RecordingView` 的量法，文案 + 16/4 内边距 + 两颗按钮约 160）：
   * 首次出现是一枚 256 宽的胶囊在 100ms 内缩到实际宽度，叠上出场淡入就是「按下 Fn 要等一下才出来」的观感
   * 之后的宽度变化（转写中、倒计时）仍走弹簧。壳收起后把宽度清掉，下一轮从头量，
   * 否则会从上一轮末尾的宽度（转写中的文案）弹回 Listening
   */
  const isFirstMeasure = lastMeasuredWidthRef.current === null && measuredWidth !== null
  useEffect(() => {
    if (!shellVisible) setMeasuredWidth(null)
  }, [shellVisible])

  return (
    <div { ...rest } ref={ elementRef } className={ cn('min-w-0', className) }>
      { children }
      <VoiceSessionNotice session={ session } />
      <AnimatePresence>
        { shellVisible && (
          <VoiceImeShell
            key="window-voice-shell"
            variant={ capsulePhase
              ? 'capsule'
              : 'card' }
            width={ shellSize.width }
            height={ shellSize.height }
            radius={ getVoiceImeShellRadius(shellMode, shellSize.height) }
            /**
             * 出场不做动画，与浮层小窗一致：那边 `showInactive` 一下就是一枚不透明的胶囊，
             * 这边之前整壳 200ms 淡入 + 上浮，Fn 松开后要再等 0.2s 才看清，被当成了响应延迟
             * 收场保留：关结果卡是「收走」，往上淡出；胶囊没了是「落下」，往下淡出
             */
            animate={ { opacity: 1, y: 0 } }
            exit={ {
              opacity: 0,
              y: shellMode === 'result'
                ? -8
                : 8,
            } }
            transition={ {
              opacity: { duration: 0.2 },
              y: { duration: 0.2 },
              ...(isFirstMeasure && { width: { duration: 0 } }),
            } }
            className="fixed inset-x-0 bottom-6 z-50 mx-auto"
          >
            <AnimatePresence mode="wait">
              { capsulePhase
                ? (
                  <RecordingView
                    key="capsule"
                    role="status"
                    aria-live="polite"
                    showActions
                    isProcessing={ capsulePhase === 'processing' }
                    remainingSeconds={ session.remainingSeconds }
                    audioLevel={ session.audioLevel }
                    onCancel={ session.cancel }
                    onStop={ session.stop }
                    onMeasure={ setMeasuredWidth }
                  />
                )
                : (
                  <TranscriptionResult
                    key="card"
                    role="status"
                    text={ session.text }
                    onDismiss={ session.reset }
                  />
                ) }
            </AnimatePresence>
          </VoiceImeShell>
        ) }
      </AnimatePresence>
    </div>
  )
})
VoiceImeWindowHost.displayName = 'VoiceImeWindowHost'

export type VoiceImeWindowHostProps = React.PropsWithChildren<Omit<React.HTMLAttributes<HTMLDivElement>, 'onError'>> & {
  /** @default true */
  active?: boolean
  /** @default true */
  editable?: boolean
  capture?: VoiceCaptureAdapter
  transcribe: VoiceTranscribeAdapter
  onTranscription?: (text: string) => void
  onPrompt?: (code: string) => void
  onError?: (error: Error) => void
}

function isWritableElement(element: Element | null): boolean {
  if (element instanceof HTMLInputElement) return ['text', 'search', 'url', 'tel', 'email'].includes(element.type) && !element.disabled && !element.readOnly
  if (element instanceof HTMLTextAreaElement) return !element.disabled && !element.readOnly
  return element instanceof HTMLElement && element.isContentEditable
}
