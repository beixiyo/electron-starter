import type { VoiceRecorderStatus } from 'comps'
import { WindowType } from '@shared'
import { SHADOW_INSET, VOICE_IME_CONTENT_SIZE, VOICE_IME_WINDOW_SIZE } from '@shared/window-config/metrics'
import { LiveWaveAudio } from 'comps'
import { useTheme, useUpdateEffect } from 'hooks'
import { Mic } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { memo } from 'react'
import { cn } from 'utils'
import { getInsetWindowHitTestRegion, useRoundedWindowHitTest } from '../shared'
import { useVoiceIme } from './useVoiceIme'

type DisplayState = 'idle' | 'recording' | 'processing'

function toDisplayState(status: VoiceRecorderStatus): DisplayState {
  if (status === 'recording')
    return 'recording'
  if (status === 'processing')
    return 'processing'
  return 'idle'
}

export function VoiceImeApp(): React.JSX.Element {
  useTheme()
  const { status, error, durationLabel, liveWaveRef, liveWaveState, handleWaveformError, handleRecordingFinish } = useVoiceIme()

  const displayState = toDisplayState(status)
  const contentSize = displayState === 'recording'
    ? VOICE_IME_CONTENT_SIZE.recording
    : VOICE_IME_CONTENT_SIZE.idle
  const windowSize = displayState === 'recording'
    ? VOICE_IME_WINDOW_SIZE.recording
    : VOICE_IME_WINDOW_SIZE.idle

  useRoundedWindowHitTest(WindowType.VOICE_IME, () => [
    getInsetWindowHitTestRegion(SHADOW_INSET, 16, windowSize),
  ])

  useUpdateEffect(() => {
    $ipc.window.resizeTo(WindowType.VOICE_IME, windowSize.width, windowSize.height, true)
  }, [displayState])

  return (
    <div style={ { padding: SHADOW_INSET } }>
      <motion.div
        className="relative overflow-hidden bg-background rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.08),0_8px_24px_rgba(0,0,0,0.12)]"
        animate={ { width: contentSize.width, height: contentSize.height } }
        transition={ { type: 'spring', stiffness: 400, damping: 35 } }
      >
        {/*
          LiveWaveAudio 必须始终挂载——liveWaveRef 在 hold 事件触发前就需要就绪。
          仅通过 opacity 控制可见性，不能用条件渲染。
        */}
        <div
          className={ cn(
            'absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 py-3',
            'transition-opacity duration-150',
            displayState !== 'recording' && 'opacity-0 pointer-events-none',
          ) }
        >
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.8)] animate-pulse shrink-0" />
            <span className="text-xs tabular-nums font-medium text-textPrimary">{ durationLabel }</span>
          </div>

          <LiveWaveAudio
            ref={ liveWaveRef }
            state={ liveWaveState }
            onError={ handleWaveformError }
            onRecordingFinish={ handleRecordingFinish }
            preferredMimeTypes={ ['audio/webm;codecs=opus'] }
          />
        </div>

        {/* idle / processing 覆盖层，覆盖在波形上方；recording 时退出，波形层透出 */}
        <AnimatePresence>
          { displayState === 'idle' && (
            <motion.div
              key="idle"
              className="absolute inset-0 bg-background flex flex-col items-center justify-center gap-1.5"
              initial={ { opacity: 0 } }
              animate={ { opacity: 1 } }
              exit={ { opacity: 0 } }
              transition={ { duration: 0.15 } }
            >
              <IdleContent />
            </motion.div>
          ) }

          { displayState === 'processing' && (
            <motion.div
              key="processing"
              className="absolute inset-0 bg-background flex flex-col items-center justify-center gap-2"
              initial={ { opacity: 0 } }
              animate={ { opacity: 1 } }
              exit={ { opacity: 0 } }
              transition={ { duration: 0.15 } }
            >
              <ProcessingContent />
            </motion.div>
          ) }
        </AnimatePresence>

        { error && (
          <motion.div
            className="absolute inset-0 z-10 flex items-center justify-center px-4 bg-background rounded-2xl"
            initial={ { opacity: 0 } }
            animate={ { opacity: 1 } }
            transition={ { duration: 0.15 } }
          >
            <span className="text-xs text-red-300 text-center leading-relaxed">{ error }</span>
          </motion.div>
        ) }
      </motion.div>
    </div>
  )
}

const IdleContent = memo(() => (
  <>
    <Mic size={ 16 } className="text-muted-foreground/50" strokeWidth={ 1.5 } />
    <span className="text-[11px] text-muted-foreground/60 tracking-wide">按住 Ctrl/Cmd E 说话</span>
  </>
))
IdleContent.displayName = 'IdleContent'

const ProcessingContent = memo(() => (
  <div className="flex items-center gap-2.5">
    <div className="flex gap-1">
      { [0, 1, 2].map(i => (
        <motion.span
          key={ i }
          className="w-1.5 h-1.5 rounded-full bg-sky-400"
          animate={ { opacity: [0.25, 1, 0.25], scale: [0.75, 1, 0.75] } }
          transition={ { duration: 1.1, repeat: Infinity, delay: i * 0.18, ease: 'easeInOut' } }
        />
      )) }
    </div>
    <span className="text-[11px] text-muted-foreground/70 tracking-wide">识别中…</span>
  </div>
))
ProcessingContent.displayName = 'ProcessingContent'
