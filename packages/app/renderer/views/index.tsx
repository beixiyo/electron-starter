import { NavLink, Outlet, useLocation } from '@jl-org/react-router'
import { CollapsibleSidebar } from 'comps'
import { Camera } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * 主布局组件，包含侧边栏导航
 */
export default function Layout() {
  const { t } = useTranslation('layout')
  const [isCollapsed, setIsCollapsed] = useState(false)
  const location = useLocation()

  const menu = [
    { key: 'recorder', path: '/recorder', icon: <Camera size={ 18 } />, label: t('menu.recorder') },
  ]

  return (
    <main className="min-h-screen bg-white dark:bg-zinc-950">
      <div className="flex min-h-screen">
        {/* 左侧折叠菜单 */ }
        <CollapsibleSidebar
          isCollapsed={ isCollapsed }
          onToggle={ () => setIsCollapsed(!isCollapsed) }
          position="left"
          expandedWidth={ 180 }
          collapsedWidth={ 64 }
          header={ {
            title: t('title'),
          } }
          className="border-r border-zinc-200 dark:border-zinc-800"
          contentClassName="p-2"
        >
          <nav className="space-y-1">
            { menu.map((item) => {
              const isActive = location.pathname === item.path
              return (
                <NavLink
                  key={ item.key }
                  to={ item.path }
                  className={ [
                    'w-full flex items-center rounded-lg px-3 py-2 transition-colors',
                    isActive
                      ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                      : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800',
                  ].join(' ') }
                  aria-current={ isActive
                    ? 'page'
                    : undefined }
                >
                  <span className="shrink-0">{ item.icon }</span>
                  { !isCollapsed && (
                    <span className="ml-3 text-sm">{ item.label }</span>
                  ) }
                </NavLink>
              )
            }) }
          </nav>
        </CollapsibleSidebar>

        {/* 右侧内容区 */ }
        <div className="flex-1 flex flex-col min-w-0">
          <Outlet />
        </div>
      </div>
    </main>
  )
}
