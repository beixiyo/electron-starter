import { memo } from 'react'
import { cn } from 'utils'
import { formatDuration } from '@jl-org/tool'

export type RecordingTimerProps = {
  /**
   * 录制时长（秒）
   */
  duration: number
  /**
   * 是否正在录制
   */
  isRecording: boolean
  /**
   * 是否暂停
   */
  isPaused: boolean
  /**
   * 自定义类名
   */
  className?: string
}

/**
 * 录制时间显示组件
 */
export const RecordingTimer = memo<RecordingTimerProps>((props) => {
  const {
    duration,
    isRecording,
    isPaused,
    className,
  } = props

  if (!isRecording && !isPaused) {
    return null
  }

  const statusTone = isRecording
    ? 'text-danger'
    : 'text-warning'

  return (
    <div className={ cn('flex items-center gap-2', className) }>
      <span className={ cn('font-mono text-sm font-medium', statusTone) }>
        { formatDuration(duration) }
      </span>
    </div>
  )
})

RecordingTimer.displayName = 'RecordingTimer'
