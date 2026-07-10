import { NavLink, Outlet, useLocation } from '@jl-org/react-router'
import { CollapsibleSidebar } from 'comps'
import { Bell, Camera, DownloadCloud, Keyboard } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AccessibilityGate, PermissionModal, usePermissions } from '../components/permission'
import { isElectron } from '../utils/env'

/**
 * 主布局组件，包含侧边栏导航
 */
export default function Layout() {
  const { t } = useTranslation('layout')
  const { t: tApp } = useTranslation('app')
  const permissionGate = usePermissions()
  const { ensure } = permissionGate
  const [isCollapsed, setIsCollapsed] = useState(false)
  const location = useLocation()

  const menu = [
    { key: 'recorder', path: '/recorder', icon: <Camera size={ 18 } />, label: t('menu.recorder') },
    { key: 'shortcuts', path: '/shortcuts', icon: <Keyboard size={ 18 } />, label: t('menu.shortcuts') },
    { key: 'notify-test', path: '/notify-test', icon: <Bell size={ 18 } />, label: t('menu.notifyTest') },
    { key: 'update', path: '/update', icon: <DownloadCloud size={ 18 } />, label: t('menu.update') },
  ]

  useEffect(() => {
    if (!isElectron())
      return

    return $ipc.permission.on('required', ({ kinds, reason }) => {
      const title = reason === 'voice-ime'
        ? tApp('permission.voiceImeMicrophoneTitle', '允许语音输入使用麦克风')
        : tApp('permission.recordingMicrophoneTitle', '允许录音使用麦克风')

      const subtitle = reason === 'voice-ime'
        ? tApp('permission.voiceImeMicrophoneSubtitle', '唤起语音输入法后，需要麦克风权限才能显示实时波形并完成转写。')
        : tApp('permission.recordingMicrophoneSubtitle', '开始录音前需要麦克风权限。点击下方按钮后，系统会弹出 macOS 授权确认。')

      ensure(kinds, {
        title,
        subtitle,
      })
    })
  }, [ensure, tApp])

  return (
    <main className="h-screen bg-white dark:bg-zinc-950">
      <div className="flex h-full">
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
        <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
          <Outlet />
        </div>
      </div>

      {/* 启动时检查辅助功能权限（Fn 长按 / 划词），缺失则引导开启 */ }
      <AccessibilityGate />

      <PermissionModal
        isOpen={ permissionGate.open }
        onClose={ permissionGate.close }
        kinds={ permissionGate.kinds }
        statuses={ permissionGate.statuses }
        title={ permissionGate.title }
        subtitle={ permissionGate.subtitle }
        canContinue={ permissionGate.canContinue }
        onRequest={ permissionGate.requestOne }
        onContinue={ permissionGate.close }
      />
    </main>
  )
}
