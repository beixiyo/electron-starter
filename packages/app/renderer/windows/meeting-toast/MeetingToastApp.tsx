import { formatDuration } from '@jl-org/tool'
import { WindowType } from '@shared'
import { MEETING_TOAST_CONTENT_SIZE, SHADOW_INSET } from '@shared/window-config/constants'
import { useTheme } from 'hooks'
import { Loader2, Pause, Play, Square, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { memo, useEffect, useMemo } from 'react'
import { cn } from 'utils'
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

export const MeetingToastApp = memo(() => {
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
  } = useMeetingToast()

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
              '[-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]',
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

      <div className="flex size-9 shrink-0 items-center justify-center">
        <div className="relative flex size-8 items-center justify-center">
          <svg viewBox="0 0 32 32" className="absolute inset-0 size-full">
            <circle
              cx="16"
              cy="16"
              r="13"
              fill="none"
              strokeWidth="2.5"
              className="stroke-sky-100 dark:stroke-sky-900/40"
            />
            <motion.circle
              cx="16"
              cy="16"
              r="13"
              fill="none"
              strokeWidth="2.5"
              strokeLinecap="round"
              className="stroke-sky-500"
              style={ {
                transformOrigin: 'center',
                rotate: -90,
                pathLength: progress,
              } }
              transition={ { duration: 0.05, ease: 'linear' } }
            />
          </svg>
          <div className="size-3.5 rounded-full bg-sky-500/15" />
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
  progress: number
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
