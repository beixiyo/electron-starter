/** 失败条：红字文案居中，重试 / ✕ 贴右；具体原因由宿主经回调另行展示。 */
import { useLatestCallback } from 'hooks'
import { Info, RotateCw, X } from 'lucide-react'
import { motion, useIsPresent } from 'motion/react'
import { memo, useLayoutEffect, useRef } from 'react'
import { cn } from 'utils'
import {
  CAPSULE_ACTION_BUTTON_CLASS,
  CAPSULE_ACTION_BUTTON_FILLED_CLASS,
  CAPSULE_ACTION_GAP,
  CAPSULE_ACTION_INSET,
  CAPSULE_ACTION_SIZE,
  CAPSULE_ACTION_STYLE,
  CAPSULE_ICON_CLASS,
  CAPSULE_TEXT_GAP,
  CAPSULE_TEXT_INSET,
} from '../constants'

/** 胶囊的宽度下限：三条文案长度差得远，短的那条别缩成一小截 */
const MIN_CONTENT_WIDTH = 200

export const FailureView = memo<FailureViewProps>((props) => {
  const { message, detail, canRetry = true, onRetry, onDismiss, onShowDetail, onMeasure, className } = props
  const textRef = useRef<HTMLSpanElement | null>(null)
  const actionsRef = useRef<HTMLDivElement | null>(null)
  const isPresent = useIsPresent()

  /**
   * 左内边距 + 文案 + 间隙 + 按钮组 + 右内边距；按钮颗数随 props 变，按钮组量 DOM
   *
   * 测宽的 ref 挂在里层的行内 span 而不是 `flex-1` 外壳：外壳的宽度是 flex 分给它的，
   * 量出来的是「当前胶囊能塞多少」而不是「文案要多宽」，胶囊永远撑不开
   */
  const measure = useLatestCallback(() => {
    const text = textRef.current
    if (!text || !onMeasure) return
    const actionsWidth = actionsRef.current?.offsetWidth ?? CAPSULE_ACTION_SIZE
    onMeasure(Math.max(
      MIN_CONTENT_WIDTH,
      Math.ceil(text.getBoundingClientRect().width) + CAPSULE_TEXT_INSET + CAPSULE_TEXT_GAP + actionsWidth + CAPSULE_ACTION_INSET,
    ))
  })

  useLayoutEffect(() => {
    if (!isPresent) return
    measure()
  }, [canRetry, detail, isPresent, message, measure, onDismiss, onRetry, onShowDetail])

  const setTextRef = useLatestCallback((node: HTMLSpanElement | null) => {
    textRef.current = node
    measure()
  })

  const setActionsRef = useLatestCallback((node: HTMLDivElement | null) => {
    actionsRef.current = node
    measure()
  })

  return (
    <motion.div
      initial={ { opacity: 0, y: 4 } }
      animate={ { opacity: 1, y: 0 } }
      exit={ { opacity: 0, y: -4 } }
      transition={ { duration: 0.16 } }
      className={ cn('flex size-full items-center overflow-hidden', className) }
      style={ { paddingLeft: CAPSULE_TEXT_INSET, paddingRight: CAPSULE_ACTION_INSET, gap: CAPSULE_TEXT_GAP } }
    >
      {
        /** 胶囊有宽度下限，文案比它短时富余落在文案两侧，让它居中而不是贴左 */
      }
      <span className="min-w-0 flex-1 whitespace-nowrap text-center text-xs font-medium leading-4.5 text-red-500">
        <span ref={ setTextRef }>{ message }</span>
      </span>

      <div ref={ setActionsRef } className="flex shrink-0 items-center" style={ { gap: CAPSULE_ACTION_GAP } }>
        { detail && onShowDetail && (
          <button
            type="button"
            aria-label="Show details"
            style={ CAPSULE_ACTION_STYLE }
            className={ CAPSULE_ACTION_BUTTON_CLASS }
            onClick={ onShowDetail }
          >
            <Info className={ CAPSULE_ICON_CLASS } />
          </button>
        ) }
        { canRetry && onRetry && (
          <button
            type="button"
            aria-label="Retry"
            style={ CAPSULE_ACTION_STYLE }
            className={ CAPSULE_ACTION_BUTTON_CLASS }
            onClick={ onRetry }
          >
            <RotateCw className={ CAPSULE_ICON_CLASS } />
          </button>
        ) }
        { onDismiss && (
          <button
            type="button"
            aria-label="Dismiss"
            style={ CAPSULE_ACTION_STYLE }
            className={ CAPSULE_ACTION_BUTTON_FILLED_CLASS }
            onClick={ onDismiss }
          >
            <X className={ CAPSULE_ICON_CLASS } />
          </button>
        ) }
      </div>
    </motion.div>
  )
})

FailureView.displayName = 'FailureView'

export type FailureViewProps = {
  message: string
  detail?: string
  canRetry?: boolean
  onRetry?: () => void
  onDismiss?: () => void
  onShowDetail?: () => void
  onMeasure?: (width: number) => void
  className?: string
}
