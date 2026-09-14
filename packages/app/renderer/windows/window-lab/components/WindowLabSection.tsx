/** Window Lab 侧栏分组。 */

import { memo } from 'react'
import { cn } from 'utils'

export const WindowLabSection = memo<WindowLabSectionProps>((props) => {
  const { title, description, children, className, ...rest } = props
  return (
    <section { ...rest } className={ cn('mb-6 last:mb-0', className) }>
      <div className="mb-3">
        <h2 className="text-xs font-semibold uppercase text-text2">{ title }</h2>
        { description && <p className="mt-1 text-xs leading-5 text-text3/70">{ description }</p> }
      </div>
      <div className="flex flex-col gap-3">{ children }</div>
    </section>
  )
})

WindowLabSection.displayName = 'WindowLabSection'

export type WindowLabSectionProps = {
  title: string
  description?: string
} & React.PropsWithChildren<React.HTMLAttributes<HTMLElement>>
