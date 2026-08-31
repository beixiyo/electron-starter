import { memo } from 'react'
import { cn } from 'utils'

/** 只读展示当前音频链路状态，不承载点击行为。 */
export const StatusPill = memo<StatusPillProps>((props) => {
  return (
    <span className={ cn(
      'inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium',
      props.active
        ? 'bg-brand/10 text-brand'
        : 'bg-background3 text-text3',
    ) }>
      { props.label }
    </span>
  )
})

StatusPill.displayName = 'StatusPill'

export type StatusPillProps = {
  label: string
  active?: boolean
}
