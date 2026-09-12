/** 转写结果视图；文本展示和关闭动作由宿主注入。 */
import { Check, Copy, X } from 'lucide-react'
import { memo, useEffect, useRef, useState } from 'react'
import { cn } from 'utils'

export const TranscriptionResult = memo<TranscriptionResultProps>((props) => {
  const { text, sourceHost, onDismiss, onCopy, className } = props
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
    <div className={ cn('flex h-full flex-col gap-2 px-4 py-3', className) }>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="text-xs text-text3">
          { sourceHost
            ? `Sent to ${sourceHost}`
            : 'Result' }
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={ copied
              ? 'Copied'
              : 'Copy' }
            className="grid size-7 shrink-0 place-items-center rounded-lg text-text3 transition-colors hover:bg-background2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text3/40"
            onClick={ handleCopy }
          >
            { copied
              ? <Check className="size-4 text-success" />
              : <Copy className="size-4" /> }
          </button>
          { onDismiss && (
            <button
              type="button"
              aria-label="Dismiss"
              className="grid size-7 shrink-0 place-items-center rounded-lg text-text3 transition-colors hover:bg-background2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text3/40"
              onClick={ onDismiss }
            >
              <X className="size-4" />
            </button>
          ) }
        </div>
      </div>
      <p className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words text-sm leading-5 text-text">{ text || 'No text' }</p>
    </div>
  )
})

TranscriptionResult.displayName = 'TranscriptionResult'

export type TranscriptionResultProps = {
  text: string
  sourceHost?: string
  /** 由宿主提供的写入器；未提供时回退到浏览器剪贴板。 */
  onCopy?: (text: string) => void | Promise<void>
  onDismiss?: () => void
  className?: string
}
