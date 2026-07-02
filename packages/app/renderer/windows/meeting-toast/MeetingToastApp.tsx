import type { MotionValue } from 'motion/react'
import type { MeetingToastInitialEvent } from './useMeetingToast'
import { formatDuration } from '@jl-org/tool'
import { WindowType } from '@shared'
import { MEETING_TOAST_CONTENT_SIZE, SHADOW_INSET } from '@shared/window-config/metrics'
import { useTheme } from 'hooks'
import { Loader2, Pause, Play, Square, Video, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { memo, useEffect, useMemo } from 'react'
import { cn } from 'utils'
import { getInsetWindowHitTestRegion, useRoundedWindowHitTest } from '../shared'
import { useMeetingToast } from './useMeetingToast'

const CONTENT_SIZE = {
  detection: MEETING_TOAST_CONTENT_SIZE,
  recording: { width: 340, height: 72 },
  mixing: { width: 260, height: 72 },
} as const

const SPRING = { type: 'spring', stiffness: 400, damping: 35 } as const

function resizeWindow(size: { width: number, height: number }) {
  $ipc.window.resizeTo(
    WindowType.MEETING_TOAST,
    size.width + SHADOW_INSET * 2,
    size.height + SHADOW_INSET * 2,
    true,
  )
}

export const MeetingToastApp = memo<MeetingToastAppProps>((props) => {
  const { initialEvent = null } = props
  useTheme()
  const {
    meeting,
    progress,
    recordingState,
    elapsed,
    handleDismiss,
    handleStartRecording,
    handlePause,
    handleResume,
    handleStop,
  } = useMeetingToast(initialEvent)

  const isRecording = recordingState?.status === 'recording'
  const isPaused = recordingState?.status === 'paused'
  const isMixing = recordingState?.status === 'mixing'
  const hasRecording = isRecording || isPaused

  const viewKey = isMixing
    ? 'mixing'
    : hasRecording
      ? 'recording'
      : 'detection'

  const visible = meeting || hasRecording || isMixing

  const contentSize = useMemo(() => CONTENT_SIZE[viewKey], [viewKey])

  useRoundedWindowHitTest(WindowType.MEETING_TOAST, () => {
    if (!visible)
      return []

    return [
      getInsetWindowHitTestRegion(SHADOW_INSET, 16, {
        width: contentSize.width + SHADOW_INSET * 2,
        height: contentSize.height + SHADOW_INSET * 2,
      }),
    ]
  })

  useEffect(() => {
    if (visible)
      resizeWindow(contentSize)
  }, [contentSize, visible])

  return (
    <div style={ { padding: SHADOW_INSET } }>
      <AnimatePresence mode="wait">
        {visible && (
          <motion.div
            key="toast-container"
            className={ cn(
              'relative overflow-hidden',
              'bg-background rounded-2xl',
              'shadow-[0_2px_8px_rgba(0,0,0,0.08),0_8px_24px_rgba(0,0,0,0.12)]',
            ) }
            initial={ { opacity: 0, y: -12, scale: 0.96 } }
            animate={ {
              opacity: 1,
              y: 0,
              scale: 1,
              width: contentSize.width,
              height: contentSize.height,
            } }
            exit={ { opacity: 0, y: -8, scale: 0.97 } }
            transition={ SPRING }
          >
            <AnimatePresence mode="wait">
              {isMixing
                ? <MixingView key="mixing" />
                : hasRecording
                  ? (
                      <RecordingView
                        key="recording"
                        elapsed={ elapsed }
                        isPaused={ isPaused }
                        onPause={ handlePause }
                        onResume={ handleResume }
                        onStop={ handleStop }
                      />
                    )
                  : meeting && (
                    <DetectionView
                      key="detection"
                      displayName={ meeting.displayName }
                      progress={ progress }
                      onRecord={ handleStartRecording }
                      onDismiss={ handleDismiss }
                    />
                  )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})

MeetingToastApp.displayName = 'MeetingToastApp'

const viewTransition = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.15 },
}

const DetectionView = memo<DetectionViewProps>((props) => {
  const { displayName, progress, onRecord, onDismiss } = props

  return (
    <motion.div className="relative flex h-full items-center gap-3 pl-4 pr-3" { ...viewTransition }>
      <button
        type="button"
        className={ cn(
          'absolute left-1.5 top-1.5',
          'flex size-4 items-center justify-center rounded-full',
          'text-muted-foreground/30 hover:text-muted-foreground/70',
          'transition-colors duration-150',
        ) }
        onClick={ onDismiss }
      >
        <X size={ 10 } strokeWidth={ 2.5 } />
      </button>

      <div className="flex size-9 shrink-0 translate-y-px items-center justify-center">
        <div className="relative flex size-8 items-center justify-center">
          <svg viewBox="0 0 32 32" className="absolute inset-0 size-full">
            <circle
              cx="16"
              cy="16"
              r="13"
              fill="none"
              strokeWidth="2.5"
              className="stroke-black/10"
            />
            <motion.circle
              cx="16"
              cy="16"
              r="13"
              fill="none"
              strokeWidth="2.5"
              strokeLinecap="round"
              className="stroke-black"
              style={ {
                transformOrigin: 'center',
                rotate: -90,
                pathLength: progress,
              } }
            />
          </svg>
          <Video size={ 14 } strokeWidth={ 2.2 } className="text-black" />
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium leading-tight text-textPrimary">
          Meeting detected
        </p>
        <p className="mt-0.5 truncate text-xs leading-tight text-muted-foreground/60">
          {displayName}
        </p>
      </div>

      <button
        type="button"
        className={ cn(
          'shrink-0 rounded-full px-4 py-2',
          'bg-zinc-900 text-[13px] font-medium text-white',
          'dark:bg-white dark:text-zinc-900',
          'hover:opacity-90 active:scale-[0.97]',
          'transition-all duration-150',
        ) }
        onClick={ onRecord }
      >
        Start Recording
      </button>
    </motion.div>
  )
})

DetectionView.displayName = 'DetectionView'

const RecordingView = memo<RecordingViewProps>((props) => {
  const { elapsed, isPaused, onPause, onResume, onStop } = props

  return (
    <motion.div className="flex h-full items-center justify-between px-4" { ...viewTransition }>
      <div className="flex items-center gap-3">
        <RecordingDot isPaused={ isPaused } />

        <div className="min-w-0">
          <p className="text-xs leading-tight text-muted-foreground/60">
            {isPaused
              ? 'Paused'
              : 'Recording'}
          </p>
          <p className={ cn(
            'mt-0.5 font-mono text-sm font-medium leading-tight',
            isPaused
              ? 'text-warning'
              : 'text-danger',
          ) }
          >
            {formatDuration(elapsed)}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          className={ cn(
            'flex size-8 items-center justify-center rounded-lg',
            'text-muted-foreground hover:text-textPrimary',
            'hover:bg-muted/60 active:scale-[0.95]',
            'transition-all duration-150',
          ) }
          onClick={ isPaused
            ? onResume
            : onPause }
        >
          {isPaused
            ? <Play size={ 14 } strokeWidth={ 2 } />
            : <Pause size={ 14 } strokeWidth={ 2 } />}
        </button>

        <button
          type="button"
          className={ cn(
            'flex size-8 items-center justify-center rounded-lg',
            'text-danger hover:bg-danger/10',
            'active:scale-[0.95] transition-all duration-150',
          ) }
          onClick={ onStop }
        >
          <Square size={ 12 } strokeWidth={ 2 } className="fill-current" />
        </button>
      </div>
    </motion.div>
  )
})

RecordingView.displayName = 'RecordingView'

const MixingView = memo(() => (
  <motion.div className="flex h-full items-center gap-3 px-4" { ...viewTransition }>
    <Loader2 size={ 16 } strokeWidth={ 2 } className="animate-spin text-muted-foreground/60" />
    <p className="text-[13px] text-muted-foreground">
      Processing...
    </p>
  </motion.div>
))

MixingView.displayName = 'MixingView'

const RecordingDot = memo<{ isPaused: boolean }>(({ isPaused }) => (
  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-danger/10">
    <motion.div
      className="size-2.5 rounded-full bg-danger"
      animate={ isPaused
        ? { opacity: 0.4 }
        : { opacity: [1, 0.3, 1] } }
      transition={ isPaused
        ? {}
        : { duration: 1.5, repeat: Infinity, ease: 'easeInOut' } }
    />
  </div>
))

RecordingDot.displayName = 'RecordingDot'

type DetectionViewProps = {
  displayName: string
  /** 倒计时进度（1 → 0），MotionValue 直驱动画，不经 React 渲染 */
  progress: MotionValue<number>
  onRecord: () => void
  onDismiss: () => void
}

type RecordingViewProps = {
  elapsed: number
  isPaused: boolean
  onPause: () => void
  onResume: () => void
  onStop: () => void
}

/**
 * Meeting Toast 首帧初始化数据
 */
export type MeetingToastAppProps = {
  initialEvent?: MeetingToastInitialEvent | null
}
