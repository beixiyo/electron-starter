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
        'inline-flex items-center rounded-md border border-border/40 bg-background2 px-2.5 py-1',
        'text-sm leading-5.5 text-text',
        className,
      ) }
    >
      {formatBinding(binding)}
    </span>
  )
})

ShortcutBadge.displayName = 'ShortcutBadge'
