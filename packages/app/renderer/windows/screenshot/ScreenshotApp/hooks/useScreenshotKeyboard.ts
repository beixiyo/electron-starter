import { useBindWinEvent } from 'hooks'
import { NUDGE_STEP, NUDGE_STEP_FAST } from '../constants'

const ARROW_DELTA: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

/**
 * 截图窗口键盘操作
 *
 * - `Escape` 取消整个会话
 * - `Enter`  确认当前选区
 * - 方向键   平移选区，按住 Shift 改为伸缩右下角，Alt 加速
 *
 * 只在已确认的选区上响应方向键：拉框途中指针仍在拖动，键盘介入会让两个输入源打架
 */
export function useScreenshotKeyboard(options: UseScreenshotKeyboardOptions) {
  const { canOperate, onCancel, onConfirm, onNudge, onNudgeSize } = options

  useBindWinEvent({
    eventName: 'keydown',
    listener: (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel()
        return
      }

      if (e.key === 'Enter') {
        if (canOperate)
          onConfirm()
        return
      }

      const delta = ARROW_DELTA[e.key]
      if (!delta || !canOperate)
        return

      /** 阻止方向键滚动视口，否则底图会偏移与选区错位 */
      e.preventDefault()

      const step = e.altKey
        ? NUDGE_STEP_FAST
        : NUDGE_STEP
      const [dx, dy] = delta

      if (e.shiftKey)
        onNudgeSize(dx * step, dy * step)
      else
        onNudge(dx * step, dy * step)
    },
  })
}

export type UseScreenshotKeyboardOptions = {
  /** 是否已有可操作的选区，决定 Enter 与方向键是否生效 */
  canOperate: boolean
  onCancel: () => void
  onConfirm: () => void
  onNudge: (dx: number, dy: number) => void
  onNudgeSize: (dx: number, dy: number) => void
}
