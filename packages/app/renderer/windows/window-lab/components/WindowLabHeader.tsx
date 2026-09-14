/** Window Lab 顶栏：只负责标题和本地场景操作。 */

import { Button } from 'comps'
import { memo } from 'react'
import { cn } from 'utils'

export const WindowLabHeader = memo<WindowLabHeaderProps>((props) => {
  const { onReset, onShowUrl, className, ...rest } = props
  return (
    <header { ...rest } className={ cn('flex h-14 shrink-0 items-center justify-between border-b border-border px-5', className) }>
      <div className="min-w-0">
        <h1 className="truncate text-sm font-semibold text-text">Window Lab</h1>
        <p className="truncate text-xs text-text3/70">Inspect shared window UI in isolated states</p>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" className={ headerButtonClass } onClick={ onShowUrl }>Scene URL</Button>
        <Button variant="ghost" size="sm" className={ headerButtonClass } onClick={ onReset }>Reset</Button>
      </div>
    </header>
  )
})

WindowLabHeader.displayName = 'WindowLabHeader'

export type WindowLabHeaderProps = {
  onReset: () => void
  onShowUrl: () => void
} & React.HTMLAttributes<HTMLElement>

const headerButtonClass =
  'rounded-lg border border-border px-2.5 py-1.5 text-xs text-text2 transition-colors hover:bg-background2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text3/40'
