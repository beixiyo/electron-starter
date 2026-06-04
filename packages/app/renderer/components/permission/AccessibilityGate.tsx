import { onMounted } from 'hooks'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { PermissionModal } from './PermissionModal'
import { usePermissions } from './usePermissions'

/**
 * 辅助功能权限启动守卫
 *
 * 挂载于主窗口根布局：启动时检查辅助功能（Fn 长按 / 划词等）权限，
 * 缺失则弹出统一权限窗引导开启。非 macOS 视为已授予，自动不弹
 */
export const AccessibilityGate = memo(() => {
  const { t } = useTranslation('app')
  const permissions = usePermissions()

  onMounted(() => {
    permissions.ensure(['accessibility'], {
      title: t('permission.accessibilityTitle', '允许应用使用辅助功能'),
      subtitle: t('permission.accessibilitySubtitle', 'Fn 长按 / 划词等功能需要辅助功能权限'),
    })
  })

  return (
    <PermissionModal
      isOpen={ permissions.open }
      onClose={ permissions.close }
      kinds={ permissions.kinds }
      statuses={ permissions.statuses }
      title={ permissions.title }
      subtitle={ permissions.subtitle }
      canContinue={ permissions.canContinue }
      onRequest={ permissions.requestOne }
      onContinue={ permissions.close }
    />
  )
})

AccessibilityGate.displayName = 'AccessibilityGate'
