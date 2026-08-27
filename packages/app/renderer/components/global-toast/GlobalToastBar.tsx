/** 全局提示窗口的纯展示条 */

import { memo } from 'react'
import { cn } from 'utils'

export const GlobalToastBar = memo<GlobalToastBarProps>((props) => {
  const { text, measureRef, className } = props

  return (
    <div
      ref={ measureRef }
      className={ cn(
        'inline-flex w-fit items-center rounded-xl bg-black/70 px-4 py-2.5 text-white',
        className,
      ) }
    >
      <span className="max-w-none whitespace-nowrap text-left text-[13px] font-normal text-white">
        { text }
      </span>
    </div>
  )
})

GlobalToastBar.displayName = 'GlobalToastBar'

export type GlobalToastBarProps = {
  /** 已完成本地化的提示文案 */
  text: string
  /** 内容挂载后用于实测尺寸的 callback ref */
  measureRef: (node: HTMLDivElement | null) => void
  className?: string
}
