/** 浮层装配只负责展示，会话和采集复用窗口及输入宿主的公共管线。 */
import { createMediaRecorderCapture, useGlobalToastNotice } from '@/components/voiceInput'
import type { VoiceCaptureAdapter, VoiceTranscribeAdapter } from '@/components/voiceInput'
import { getVoiceInputPromptMessage } from '@/components/voiceInput/messages'
import { useVoiceSession } from '@/components/voiceInput/useVoiceSession'
import { useVoiceImeEscapeShield } from '@/hooks/useVoiceImeEscapeShield'
import { isElectron } from '@/utils/env'
import { VOICE_IME_RESULT_AUTO_HIDE_MS, WindowType } from '@shared'
import { useLatestCallback, useTheme } from 'hooks'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from 'utils'
import { VoiceImeSurface } from './VoiceImeApp/components'
import type { VoiceImeViewMode } from './VoiceImeApp/constants'
import { useVoiceImeViewport, useVoiceImeWindowHitTest } from './VoiceImeApp/hooks'

export const VoiceImeApp = memo<VoiceImeAppProps>((props) => {
  const { capture: injectedCapture, transcribe, className, style } = props
  useTheme()
  useGlobalToastNotice()
  useVoiceImeEscapeShield()
  const capture = useMemo(() => injectedCapture ?? createMediaRecorderCapture(), [injectedCapture])
  const showReason = useLatestCallback((text: string) => {
    if (isElectron()) $ipc.globalToast.send('show', { text: getVoiceInputPromptMessage(text), duration: 5000, anchorWindowType: WindowType.VOICE_IME })
  })
  const session = useVoiceSession({
    capture,
    transcribe,
    onError: (error) => showReason(error.message),
    onPrompt: showReason,
    onUndoExpire: () => void dismiss(),
  })
  const showFailureDetail = useLatestCallback(() => {
    if (session.error) showReason(session.error)
  })
  /**
   * 空闲也画成录音胶囊而不是 `prompt`：窗口只在会话里可见，空闲时早就收起了，
   * 让它停在胶囊态，下次 Fn 展示的第一帧就是胶囊，不会从提示条缩成胶囊
   */
  const viewMode: VoiceImeViewMode = session.text
    ? 'result'
    : session.phase === 'idle' || session.phase === 'result' || session.phase === 'processing'
    ? 'recording'
    : session.phase
  const {
    viewMode: displayedMode,
    size,
    shadowInset,
    mountKey,
    switchView,
    reportContentWidth,
    hideAndReset,
  } = useVoiceImeViewport()
  /** 壳元素：点击穿透的命中区按它的实际矩形算，窗口本身比壳大得多 */
  const shellRef = useRef<HTMLDivElement>(null)
  useVoiceImeWindowHitTest(displayedMode, shellRef)
  const closingRef = useRef(false)
  const restoreAfterCloseRef = useRef(false)
  const [isClosing, setIsClosing] = useState(false)
  useEffect(() => {
    if (isClosing) return
    if (displayedMode === viewMode) {
      restoreAfterCloseRef.current = false
      return
    }
    switchView(viewMode)
    if (restoreAfterCloseRef.current && isElectron()) {
      restoreAfterCloseRef.current = false
      void $ipc.window.show(WindowType.VOICE_IME)
    }
  }, [displayedMode, isClosing, viewMode, switchView])

  const copyResult = useLatestCallback(async (value: string) => {
    const revision = session.getResultRevision()
    if (isElectron()) await $ipc.clipboard.writeText(value)
    else await navigator.clipboard.writeText(value)
    if (session.getResultRevision() === revision) await dismiss()
  })
  const dismiss = useLatestCallback(async () => {
    if (closingRef.current) return
    closingRef.current = true
    setIsClosing(true)
    const revision = session.getResultRevision()
    try {
      await hideAndReset()
      if (session.getResultRevision() === revision) session.reset()
    }
    finally {
      closingRef.current = false
      restoreAfterCloseRef.current = true
      setIsClosing(false)
    }
  })
  useEffect(() => {
    if (!session.text || import.meta.env.DEV) return
    const timer = setTimeout(() => void dismiss(), VOICE_IME_RESULT_AUTO_HIDE_MS)
    return () => clearTimeout(timer)
  }, [session.text, dismiss])

  useEffect(() => {
    if (!isElectron()) return
    const offDismiss = $ipc.voiceIme.on('dismiss', () => void dismiss())
    let lastSessionId: string | null = null
    const offRound = $ipc.voiceIme.on('activeChanged', (snapshot) => {
      if (snapshot.phase === 'recording' && snapshot.sessionId !== lastSessionId) {
        lastSessionId = snapshot.sessionId
        $ipc.globalToast.send('dismiss')
      }
    })
    const offStatus = $ipc.voiceIme.on('status', (payload) => {
      if (payload.error) showReason(payload.error)
    })
    return () => {
      offDismiss()
      offStatus()
      offRound()
    }
  }, [dismiss, showReason])
  useEffect(() => {
    if (session.completed && !session.text) void dismiss()
  }, [session.completed, session.text, dismiss])

  return (
    <div className={ cn('h-full', className) } style={ style }>
      <VoiceImeSurface
        /** 收窗即换代：整棵形态树重挂成初始形态，理由见 `useVoiceImeViewport.mountKey` */
        key={ mountKey }
        shellRef={ shellRef }
        viewMode={ displayedMode }
        size={ size }
        shadowInset={ shadowInset }
        durationLabel={ session.phase === 'processing'
          ? 'Processing'
          : 'Listening' }
        remainingSeconds={ session.remainingSeconds }
        audioLevel={ session.audioLevel }
        isProcessing={ session.phase === 'processing' }
        text={ session.text }
        onCopy={ copyResult }
        message="Transcription failed"
        detail={ session.error ?? undefined }
        onShowDetail={ showFailureDetail }
        expiresAt={ session.undoExpiresAt }
        onMeasure={ reportContentWidth }
        onStart={ session.requestStart }
        onUndo={ session.undo }
        onDismiss={ dismiss }
        onRetry={ session.canRetry
          ? session.retry
          : undefined }
        onStop={ session.stop }
        onCancel={ session.cancel }
      />
    </div>
  )
})
VoiceImeApp.displayName = 'VoiceImeApp'

export type VoiceImeAppProps = {
  /** @default 浏览器 MediaRecorder 采集 */
  capture?: VoiceCaptureAdapter
  /** 所有转写均由调用方注入，可使用明确标识的演示适配器。 */
  transcribe: VoiceTranscribeAdapter
  className?: string
  style?: React.CSSProperties
}
