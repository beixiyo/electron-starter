/** 转写结果卡的内容；底色 / 圆角 / 投影由外面的 `VoiceImeShell` 画，文本与关闭动作由宿主注入。 */
import { AudioLines, X } from 'lucide-react'
import type { HTMLMotionProps } from 'motion/react'
import { motion } from 'motion/react'
import { memo, useEffect, useRef, useState } from 'react'
import { cn } from 'utils'

/**
 * 结果卡：标题栏（图标 / 标题 / ✕）+ 白色内面板（正文 + 两颗等宽按钮）
 *
 * 几何逐值取设计稿「转写结果」卡：标题栏 44 高、图标与 ✕ 各 32 的圆框贴两侧 10px；
 * 内面板 20 圆角、白底，正文 14px；按钮 36 高、10 圆角，左灰右黑各占一半
 * 卡底 Bg/3 由壳给，顶部再压一层品牌色 6% → 0 的渐变，与胶囊白底区分出「这是一张卡」
 */
export const TranscriptionResult = memo<TranscriptionResultProps>((props) => {
  const { text, sourceHost, onDismiss, onCopy, className, ...rest } = props
  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<number | null>(null)

  useEffect(() => () => {
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
  }, [])

  const handleCopy = async () => {
    const copy = onCopy ?? (navigator.clipboard
      ? (value: string) => navigator.clipboard.writeText(value)
      : undefined)
    if (!copy) return

    try {
      await copy(text)
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
      setCopied(true)
      copyTimerRef.current = window.setTimeout(() => {
        copyTimerRef.current = null
        setCopied(false)
      }, 1200)
    }
    catch {
      setCopied(false)
    }
  }

  return (
    <motion.div
      { ...rest }
      initial={ { opacity: 0, y: 8 } }
      animate={ { opacity: 1, y: 0 } }
      exit={ { opacity: 0, y: -8 } }
      transition={ { duration: 0.2 } }
      className={ cn('relative flex h-full flex-col overflow-hidden text-text', className) }
    >
      <div className="pointer-events-none absolute inset-0 bg-linear-to-b from-brand/6 to-brand/0 to-1/2" />

      <div className="relative flex h-11 shrink-0 items-center gap-2 py-1.5">
        <div className="flex shrink-0 items-center pl-2.5">
          <div className="flex size-8 items-center justify-center overflow-hidden rounded-[7px] text-text2/70">
            <AudioLines className="size-5 shrink-0" strokeWidth={ 1.6 } aria-hidden="true" />
          </div>
        </div>

        <div className="min-w-0 flex-1 truncate text-center text-sm font-normal leading-normal text-text">
          { sourceHost
            ? `Sent to ${sourceHost}`
            : 'Transcription result' }
        </div>

        <div className="flex shrink-0 items-center pr-2.5">
          <button
            type="button"
            aria-label="Dismiss"
            className="flex size-8 items-center justify-center rounded-full text-text transition-colors hover:bg-text/5"
            onClick={ onDismiss }
          >
            <X className="size-5" strokeWidth={ 1.6 } />
          </button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col rounded-[20px] bg-background pt-4">
        <div className="min-h-0 flex-1 px-4">
          <p className="max-h-full overflow-auto whitespace-pre-wrap wrap-break-word text-sm font-normal leading-normal text-text">
            { text || 'No text' }
          </p>
        </div>

        <div className="mt-auto flex shrink-0 items-start gap-2 px-4 pb-4 pt-4">
          <button
            type="button"
            aria-label={ copied
              ? 'Copied'
              : 'Copy' }
            className="flex h-9 min-w-0 flex-1 items-center justify-center rounded-[10px] bg-background3 px-3 text-sm font-normal leading-normal text-text transition-colors hover:bg-background4"
            onClick={ handleCopy }
          >
            { copied
              ? 'Copied'
              : 'Copy' }
          </button>

          <button
            type="button"
            className="flex h-9 min-w-0 flex-1 items-center justify-center rounded-[10px] bg-text px-3 text-sm font-normal leading-normal text-textSpecial transition-opacity hover:opacity-90"
            onClick={ onDismiss }
          >
            Done
          </button>
        </div>
      </div>
    </motion.div>
  )
})

TranscriptionResult.displayName = 'TranscriptionResult'

export type TranscriptionResultProps = {
  text: string
  sourceHost?: string
  /** 由宿主提供的写入器；未提供时回退到浏览器剪贴板。 */
  onCopy?: (text: string) => void | Promise<void>
  onDismiss?: () => void
  /** DOM 自带的 `onCopy` 是剪贴板事件，与上面的写入器同名，透传时排除以免类型打架 */
} & Omit<HTMLMotionProps<'div'>, 'initial' | 'animate' | 'exit' | 'transition' | 'onCopy'>
