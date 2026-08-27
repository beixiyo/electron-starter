import { AppSidebar } from '@/components/layout/AppSidebar'
import { Outlet } from '@jl-org/react-router'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { AccessibilityGate, PermissionModal, usePermissions } from '../components/permission'
import { isElectron, isMac } from '../utils/env'

/**
 * 主布局组件，包含侧边栏导航
 */
export default function Layout() {
  const { t: tApp } = useTranslation('app')
  const permissionGate = usePermissions()
  const { ensure } = permissionGate
  const showMacTrafficLightBar = isElectron() && isMac()

  useEffect(() => {
    if (!isElectron()) return

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
    <main className="flex h-screen w-screen flex-col overflow-hidden bg-background3">
      { showMacTrafficLightBar && <div className="h-10 w-full shrink-0 bg-background3 [-webkit-app-region:drag]" /> }

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="w-16 shrink-0">
          <AppSidebar />
        </div>

        <div className="min-h-0 min-w-0 flex-1 overflow-hidden rounded-tl-[20px] bg-background shadow-[-8px_8px_30px_rgba(0,0,0,0.04)]">
          <Outlet />
        </div>
      </div>

      { /* 启动时检查辅助功能权限（Fn 长按 / 划词），缺失则引导开启 */ }
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
