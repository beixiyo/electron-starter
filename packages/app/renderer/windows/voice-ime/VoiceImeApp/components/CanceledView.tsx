/** 取消后的五秒撤销条：文案贴左，撤销 / ✕ 贴右，底边一道随剩余时间收回的品牌色细线。 */
import { useLatestCallback } from 'hooks'
import { Undo2, X } from 'lucide-react'
import { motion, useIsPresent } from 'motion/react'
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
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
  VOICE_UNDO_WINDOW_MS,
} from '../constants'

/** 胶囊的宽度下限：短文案下也别缩成一小截，且从录音条切过来时不先缩一下再展开 */
const MIN_CONTENT_WIDTH = 200

export const CanceledView = memo<CanceledViewProps>((props) => {
  const { expiresAt, onUndo, onDismiss, onMeasure, className } = props
  const [now, setNow] = useState(() => Date.now())
  const textRef = useRef<HTMLSpanElement | null>(null)
  const isPresent = useIsPresent()
  const remainingMs = expiresAt === null
    ? null
    : Math.max(0, expiresAt - now)
  const progress = remainingMs === null
    ? 1
    : remainingMs / VOICE_UNDO_WINDOW_MS

  useEffect(() => {
    if (expiresAt === null) return
    const timer = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(timer)
  }, [expiresAt])

  /** 左内边距 + 文案 + 间隙 + 两颗按钮 + 右内边距，按钮几何全是常量 */
  const measure = useLatestCallback(() => {
    if (!onMeasure || !textRef.current) return
    const reserved = CAPSULE_TEXT_INSET + CAPSULE_TEXT_GAP + CAPSULE_ACTION_SIZE * 2 + CAPSULE_ACTION_GAP + CAPSULE_ACTION_INSET
    onMeasure(Math.max(MIN_CONTENT_WIDTH, Math.ceil(textRef.current.getBoundingClientRect().width) + reserved))
  })

  useLayoutEffect(() => {
    if (!isPresent) return
    measure()
  }, [isPresent, measure])

  const setTextRef = useLatestCallback((node: HTMLSpanElement | null) => {
    textRef.current = node
    measure()
  })

  return (
    <motion.div
      initial={ { opacity: 0, y: 4 } }
      animate={ { opacity: 1, y: 0 } }
      exit={ { opacity: 0, y: -4 } }
      transition={ { duration: 0.16 } }
      className={ cn('relative flex size-full items-center overflow-hidden rounded-full', className) }
      style={ { paddingLeft: CAPSULE_TEXT_INSET, paddingRight: CAPSULE_ACTION_INSET, gap: CAPSULE_TEXT_GAP } }
    >
      {
        /*
         * 铺满整个底边而不留内边距：壳的 `overflow-hidden` + 正圆头会把两端按圆弧裁掉，
         * 两头自然收成设计稿里那个内缩的样子；描边是 inset 阴影不占布局，这条线才能真正贴底
         */
      }
      <span
        className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 origin-left bg-brand"
        style={ { transform: `scaleX(${progress})` } }
        aria-hidden="true"
      />

      <span ref={ setTextRef } className="shrink-0 whitespace-nowrap text-xs font-medium leading-4.5 text-text2/70">
        Transcription canceled
      </span>

      <div className="ml-auto flex shrink-0 items-center" style={ { gap: CAPSULE_ACTION_GAP } }>
        <button
          type="button"
          aria-label="Undo"
          disabled={ remainingMs !== null && remainingMs <= 0 }
          style={ CAPSULE_ACTION_STYLE }
          className={ cn(CAPSULE_ACTION_BUTTON_CLASS, 'disabled:pointer-events-none disabled:opacity-40') }
          onClick={ onUndo }
        >
          <Undo2 className={ CAPSULE_ICON_CLASS } />
        </button>
        <button
          type="button"
          aria-label="Dismiss"
          style={ CAPSULE_ACTION_STYLE }
          className={ CAPSULE_ACTION_BUTTON_FILLED_CLASS }
          onClick={ onDismiss }
        >
          <X className={ CAPSULE_ICON_CLASS } />
        </button>
      </div>
    </motion.div>
  )
})

CanceledView.displayName = 'CanceledView'

export type CanceledViewProps = {
  expiresAt: number | null
  onUndo: () => void
  onDismiss: () => void
  onMeasure?: (width: number) => void
  className?: string
}
