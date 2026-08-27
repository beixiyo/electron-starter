/** 录制页面的响应式外壳，统一桌面端与 Web 端的尺寸、间距和滚动边界 */

import { memo } from 'react'
import { cn } from 'utils'

export const RecorderPageLayout = memo<RecorderPageLayoutProps>((props) => {
  const {
    title,
    subtitle,
    sidebar,
    children,
    className,
  } = props

  return (
    <div className={ cn('h-full min-h-0 overflow-y-auto bg-background px-4 py-5 text-sm text-text sm:px-6 sm:py-7 lg:px-8 lg:py-8', className) }>
      <div className="mx-auto flex min-h-full w-full max-w-360 flex-col">
        <header className="mb-5 shrink-0 sm:mb-6">
          <h1 className="text-[22px] font-medium leading-8 text-text">{ title }</h1>
          { subtitle && <p className="mt-1 max-w-2xl text-sm leading-6 text-text3">{ subtitle }</p> }
        </header>

        <div className="grid min-h-0 min-w-0 flex-1 gap-5 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-6">
          <div className="min-w-0">{ sidebar }</div>
          <main className="flex min-h-0 min-w-0 flex-col gap-5">{ children }</main>
        </div>
      </div>
    </div>
  )
})

RecorderPageLayout.displayName = 'RecorderPageLayout'

export type RecorderPageLayoutProps = React.PropsWithChildren<{
  title: React.ReactNode
  subtitle?: React.ReactNode
  sidebar: React.ReactNode
  className?: string
}>
