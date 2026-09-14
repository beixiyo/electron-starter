/** 录音中的胶囊内容：状态文案 + 倒计时，Listening 时底边一层跟着音量起伏的光效。 */
import { BottomGlow } from 'comps'
import { useLatestCallback } from 'hooks'
import { Check, X } from 'lucide-react'
import type { HTMLMotionProps } from 'motion/react'
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
  CAPSULE_COUNTDOWN_CLASS,
  CAPSULE_ICON_CLASS,
  CAPSULE_PADDING_X,
  CAPSULE_STATUS_TEXT_CLASS,
  CAPSULE_TEXT_GAP,
  CAPSULE_TEXT_INSET,
  TRANSCRIBING_PULSE_SEC,
} from '../constants'

/**
 * 浮层与嵌入态共用的录音胶囊内容；壳（底色 / 圆角 / 投影）由外面的 `VoiceImeShell` 画
 *
 * 按设计稿「语音输入法」组件：没有图标、没有波形，只有状态文案与倒计时
 * 宽度由本组件实测后经 `onMeasure` 交还宿主：胶囊按内容 hug，只有这里知道当前文案、
 * 倒计时与按钮各占多宽。嵌入态开 `showActions` 把取消 / 完成两颗按钮画进同一条胶囊
 * （文案贴左、按钮贴右，与撤销条同一套几何）；浮层态没有端内按钮，结束录音走快捷键
 */
export const RecordingView = memo<RecordingViewProps>((props) => {
  const {
    durationLabel = 'Listening',
    remainingSeconds = null,
    isProcessing = false,
    audioLevel = 0,
    showActions = false,
    onCancel,
    onStop,
    onMeasure,
    className,
    style,
    ...rest
  } = props
  const contentRef = useRef<HTMLDivElement | null>(null)
  const isPresent = useIsPresent()
  const label = isProcessing
    ? 'Processing'
    : durationLabel
  const countdown = remainingSeconds !== null && !isProcessing
    ? `${remainingSeconds}s`
    : null

  /** 纯文案胶囊左右各 28；带按钮时文案侧 16、按钮侧只留把圆头嵌进去的 4 */
  const paddingLeft = showActions
    ? CAPSULE_TEXT_INSET
    : CAPSULE_PADDING_X
  const paddingRight = showActions
    ? CAPSULE_ACTION_INSET
    : CAPSULE_PADDING_X

  /** 按钮组的几何全是常量，不必量 DOM：两颗按钮 + 按钮间距 + 与文案的间隙 */
  const actionsWidth = showActions
    ? CAPSULE_ACTION_SIZE * 2 + CAPSULE_ACTION_GAP + CAPSULE_TEXT_GAP
    : 0

  const measure = useLatestCallback(() => {
    const content = contentRef.current
    if (!content || !onMeasure) return
    onMeasure(Math.ceil(content.scrollWidth) + paddingLeft + actionsWidth + paddingRight)
  })

  const setContentRef = useLatestCallback((node: HTMLDivElement | null) => {
    contentRef.current = node
    measure()
  })

  useLayoutEffect(() => {
    if (!isPresent) return
    measure()
  }, [isPresent, label, countdown, showActions, measure])

  return (
    <motion.div
      { ...rest }
      initial={ { opacity: 0 } }
      animate={ { opacity: 1 } }
      exit={ { opacity: 0 } }
      transition={ { duration: 0.15 } }
      className={ cn(
        'relative flex size-full items-center overflow-hidden rounded-full',
        showActions
          ? 'justify-start'
          : 'justify-center',
        className,
      ) }
      style={ { paddingLeft, paddingRight, ...style } }
    >
      {
        /*
         * 光效只在 Listening 亮：转写期间已经没有采集，读到的音量恒为 0，
         * 转写态就是一枚纯色胶囊，靠文案呼吸表达「还在处理」
         * 铺满胶囊即可：`BottomGlow` 的默认椭圆组成就是按胶囊标定的；底衬用壳的
         * `--background` 三元组而不是写死白色，深色主题下光效同样从底色里透出来
         */
      }
      { !isProcessing && (
        <BottomGlow
          level={ audioLevel }
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-0 size-full rounded-full"
          baseColor="rgb(var(--background))"
        />
      ) }

      <div
        ref={ setContentRef }
        className="relative z-10 flex items-center"
        style={ { gap: CAPSULE_TEXT_GAP } }
      >
        { isProcessing
          ? (
            <motion.span
              /** 设计稿：转写期间文案在 0 与 100% 之间交叉变化，单程一秒 */
              animate={ { opacity: 0 } }
              transition={ {
                duration: TRANSCRIBING_PULSE_SEC,
                repeat: Number.POSITIVE_INFINITY,
                repeatType: 'reverse',
                ease: 'easeInOut',
              } }
              className={ cn(CAPSULE_STATUS_TEXT_CLASS, 'text-text') }
            >
              { label }
            </motion.span>
          )
          : <span className={ cn(CAPSULE_STATUS_TEXT_CLASS, 'text-text3/50') }>{ label }</span> }

        { countdown && <span className={ CAPSULE_COUNTDOWN_CLASS }>{ countdown }</span> }
      </div>

      { showActions && (
        <div
          /** `ml-auto`：两侧留白是定值、文案左对齐，胶囊比内容宽时富余落在中间 */
          className="relative z-10 ml-auto flex shrink-0 items-center"
          style={ { gap: CAPSULE_ACTION_GAP } }
        >
          <button
            type="button"
            aria-label="Cancel"
            style={ CAPSULE_ACTION_STYLE }
            className={ CAPSULE_ACTION_BUTTON_CLASS }
            onClick={ onCancel }
          >
            <X className={ CAPSULE_ICON_CLASS } />
          </button>
          <button
            type="button"
            aria-label="Finish"
            disabled={ isProcessing }
            style={ CAPSULE_ACTION_STYLE }
            className={ cn(CAPSULE_ACTION_BUTTON_FILLED_CLASS, 'disabled:pointer-events-none disabled:opacity-40') }
            onClick={ onStop }
          >
            <Check className={ CAPSULE_ICON_CLASS } />
          </button>
        </div>
      ) }
    </motion.div>
  )
})

RecordingView.displayName = 'RecordingView'

export type RecordingViewProps = {
  durationLabel?: string
  remainingSeconds?: number | null
  isProcessing?: boolean
  /** 实测胶囊宽度（含左右内边距与按钮组、不含窗口阴影留白） */
  onMeasure?: (width: number) => void
  /** 归一化音量（0-1），Listening 时底边光效据此起伏 @default 0 */
  audioLevel?: number
  /**
   * 是否把取消 / 完成按钮画进胶囊
   *
   * 嵌入态没有全局快捷键收尾，需要端内按钮；浮层态按产品规则不带按钮
   * @default false
   */
  showActions?: boolean
  onCancel?: () => void | Promise<void>
  onStop?: () => void | Promise<void>
} & Omit<HTMLMotionProps<'div'>, 'initial' | 'animate' | 'exit' | 'transition'>
