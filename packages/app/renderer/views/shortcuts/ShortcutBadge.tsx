import type { ShortcutBinding } from './types'
import { memo } from 'react'
import { cn } from 'utils'
import { formatBinding } from './types'

type Props = {
  binding: ShortcutBinding | null
  className?: string
}

export const ShortcutBadge = memo<Props>(({ binding, className }) => {
  if (!binding) {
    return (
      <span className={ cn('text-sm text-text3', className) }>
        未设置
      </span>
    )
  }

  return (
    <span
      className={ cn(
        'inline-flex items-center rounded-md px-2.5 py-1',
        'bg-background2 border border-border text-sm font-mono text-text2',
        className,
      ) }
    >
      {formatBinding(binding)}
    </span>
  )
})

ShortcutBadge.displayName = 'ShortcutBadge'
