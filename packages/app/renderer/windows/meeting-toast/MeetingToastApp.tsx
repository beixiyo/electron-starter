import type { MotionValue } from 'motion/react'
import type { MeetingToastInitialEvent } from './useMeetingToast'
import { formatDuration } from '@jl-org/tool'
import { WindowType } from '@shared'
import { MEETING_TOAST_CONTENT_SIZE, SHADOW_INSET } from '@shared/window-config/metrics'
import { CountdownBorder } from 'comps'
import { useTheme } from 'hooks'
import { AudioLines, Loader2, Pause, Play, Square, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { memo, useEffect, useMemo } from 'react'
import { cn } from 'utils'
import { getInsetWindowHitTestRegion, useRoundedWindowHitTest } from '../shared'
import { useMeetingToast } from './useMeetingToast'

/** 检测态描边参数：紫色倒计时描边 + 白底内缩（内缩量 = 可见紫线宽度） */
const BORDER_RADIUS = 16
const BORDER_STROKE = 6
const COUNTDOWN_START_X = 118

/** 关闭按钮：18px 圆钮，悬出容器左上角外 (-7, -5) */
const CLOSE_BTN_SIZE = 18
const CLOSE_BTN_OFFSET_X = -7
const CLOSE_BTN_OFFSET_Y = -5

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

    const regions = [
      getInsetWindowHitTestRegion(SHADOW_INSET, 16, {
        width: contentSize.width + SHADOW_INSET * 2,
        height: contentSize.height + SHADOW_INSET * 2,
      }),
    ]

    /** 检测态关闭按钮悬出圆角矩形外，单独补一块命中区域，否则点击被穿透 */
    if (viewKey === 'detection') {
      regions.push({
        x: SHADOW_INSET + CLOSE_BTN_OFFSET_X,
        y: SHADOW_INSET + CLOSE_BTN_OFFSET_Y,
        width: CLOSE_BTN_SIZE,
        height: CLOSE_BTN_SIZE,
        radius: CLOSE_BTN_SIZE / 2,
      })
    }

    return regions
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
              'relative rounded-2xl',
              'shadow-[0_2px_8px_rgba(0,0,0,0.08),0_8px_24px_rgba(0,0,0,0.12)]',
              /**
               * 检测态由 CountdownBorder 提供白底 + 紫描边、关闭按钮悬出容器外，
               * 故容器不加 bg / overflow-hidden；录制 / 处理态沿用白底裁切容器
               */
              viewKey !== 'detection' && 'overflow-hidden bg-background',
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
    <motion.div className="relative h-full w-full" { ...viewTransition }>
      <CountdownBorder
        width={ CONTENT_SIZE.detection.width }
        height={ CONTENT_SIZE.detection.height }
        radius={ BORDER_RADIUS }
        strokeWidth={ BORDER_STROKE }
        startX={ COUNTDOWN_START_X }
        progress={ progress }
        className="bg-transparent"
        contentClassName={ cn(
          /**
           * 紫色倒计时描边必须是最外沿：容器透明，白底盖在描边上、只露出边缘一圈
           * 可见紫线宽度 = 白底内缩量（此处 3px），与 strokeWidth 无关——
           * strokeWidth 只需 ≥ 2× 内缩量把可见环垫满即可（故用 6 而非更大）
           * 内缩量放大时同步：h-[calc(100%-2×内缩)]、圆角 = 16 - 内缩
           */
          'm-[3px] h-[calc(100%-6px)] rounded-[13px] bg-background',
          'flex items-center gap-2 py-3 pl-2.5 pr-3',
        ) }
      >
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-[9px] bg-brand/10">
            <AudioLines size={ 18 } strokeWidth={ 2.2 } className="text-brand" />
          </div>

          <div className="flex w-36 min-w-0 shrink-0 flex-col leading-[22px]">
            <p className="truncate text-sm font-semibold leading-[22px] text-text">
              Meeting detected
            </p>
            <p className="truncate text-sm leading-[22px] text-text2">
              {displayName}
            </p>
          </div>
        </div>

        <button
          type="button"
          className={ cn(
            'flex h-10 flex-1 items-center justify-center rounded-xl',
            'bg-button text-sm font-medium leading-[22px] text-textSpecial',
            'hover:opacity-90 active:scale-[0.97]',
            'transition-all duration-150',
          ) }
          onClick={ onRecord }
        >
          Start Recording
        </button>
      </CountdownBorder>

      {/* 关闭按钮悬出左上角外，CountdownBorder 有 overflow-hidden，必须放兄弟层 */}
      <button
        type="button"
        aria-label="Dismiss"
        className={ cn(
          'absolute z-10 flex items-center justify-center rounded-full',
          'bg-button2 border border-border text-text2',
          'hover:bg-background3 hover:text-text active:scale-95',
          'transition-all duration-150',
        ) }
        style={ {
          width: CLOSE_BTN_SIZE,
          height: CLOSE_BTN_SIZE,
          left: CLOSE_BTN_OFFSET_X,
          top: CLOSE_BTN_OFFSET_Y,
        } }
        onClick={ onDismiss }
      >
        <X className="size-2.5" />
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
