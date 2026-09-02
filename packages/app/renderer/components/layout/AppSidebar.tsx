/**
 * 主窗口的轻量导航栏，承载全局入口并保持 Flowtica 的 64px 导航节奏
 */
import { NavLink, useLocation } from '@jl-org/react-router'
import { Bell, Camera, DownloadCloud, Keyboard, Layers3, MessageSquareText, ScanLine } from 'lucide-react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from 'utils'

const NAV_ITEMS = [
  { key: 'recorder', path: '/recorder', Icon: Camera },
  { key: 'screenshotTest', path: '/screenshot-test', Icon: ScanLine },
  { key: 'shortcuts', path: '/shortcuts', Icon: Keyboard },
  { key: 'notifyTest', path: '/notify-test', Icon: Bell },
  { key: 'globalToastTest', path: '/global-toast-test', Icon: MessageSquareText },
  { key: 'update', path: '/update', Icon: DownloadCloud },
] as const

/**
 * Flowtica 风格的固定窄侧栏
 *
 * 导航项本身只描述路由策略，窗口尺寸与页面内容仍由各自模块负责
 */
export const AppSidebar = memo(() => {
  const { t } = useTranslation('layout')
  const location = useLocation()

  return (
    <aside className="relative flex h-full w-16 flex-col items-center overflow-hidden bg-background3">
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-150 w-48 -translate-x-1/2 -translate-y-1/2 bg-[radial-gradient(ellipse_at_center,rgb(247_240_247)_0%,rgb(var(--background3)/1)_70%,transparent_100%)] dark:opacity-10" />

      <div className="relative z-10 flex h-full w-full flex-col items-center">
        <div className="flex shrink-0 py-3">
          <div className="flex size-8 items-center justify-center rounded-[10px] bg-button text-button3 shadow-button">
            <Layers3 size={ 17 } strokeWidth={ 2 } aria-hidden />
          </div>
        </div>

        <nav className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 overflow-y-auto px-1">
          { NAV_ITEMS.map(({ key, path, Icon }) => {
            const isActive = location.pathname === path

            return (
              <NavLink
                key={ key }
                to={ path }
                aria-current={ isActive
                  ? 'page'
                  : undefined }
                className={ cn(
                  'flex w-14 flex-col items-center gap-1.5 rounded-xl px-1 py-2 text-center transition-colors',
                  isActive
                    ? 'text-text'
                    : 'text-text3 hover:text-text2',
                ) }
              >
                <Icon
                  size={ 19 }
                  strokeWidth={ isActive
                    ? 2
                    : 1.7 }
                />
                <span className="max-w-full truncate text-[10px] leading-3">
                  { t(`menu.${key}`) }
                </span>
              </NavLink>
            )
          }) }
        </nav>

        <div className="h-4 shrink-0" />
      </div>
    </aside>
  )
})

AppSidebar.displayName = 'AppSidebar'
