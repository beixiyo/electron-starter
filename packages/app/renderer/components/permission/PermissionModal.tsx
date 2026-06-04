import type { PermissionKind, PermissionStatus } from '@shared'
import type { PermissionStatusMap } from './types'
import { Button, Modal } from 'comps'
import { Check } from 'lucide-react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { PERMISSION_META } from './constants'

/**
 * 统一权限引导弹窗
 *
 * 由 {@link usePermissions} 驱动：根据 `kinds` 渲染对应权限行，逐项引导用户主动开启，
 * 全部满足后「继续」可点。麦克风 / 屏幕录制 / 辅助功能等通用复用
 */
export const PermissionModal = memo<PermissionModalProps>((props) => {
  const {
    isOpen,
    onClose,
    kinds,
    statuses,
    title,
    subtitle,
    canContinue,
    onRequest,
    onContinue,
  } = props

  const { t } = useTranslation('app')

  return (
    <Modal
      isOpen={ isOpen }
      onClose={ onClose }
      width={ 520 }
      showCloseBtn
      clickOutsideClose={ false }
      header={ null }
      footer={ null }
    >
      <div className="space-y-6">
        <header className="space-y-2">
          <h2 className="text-2xl font-bold leading-snug text-text">
            { title ?? t('permission.title', '需要以下权限') }
          </h2>
          <p className="text-sm text-text2">
            { subtitle ?? t('permission.subtitle', '请授予权限以使用该功能') }
          </p>
        </header>

        <div className="space-y-3">
          { kinds.map(kind => (
            <PermissionRow
              key={ kind }
              kind={ kind }
              status={ statuses[kind] }
              onAction={ () => onRequest(kind) }
            />
          )) }
        </div>

        <Button
          variant="primary"
          size="lg"
          block
          disabled={ !canContinue }
          onClick={ onContinue }
        >
          { t('permission.continue', '继续') }
        </Button>
      </div>
    </Modal>
  )
})

PermissionModal.displayName = 'PermissionModal'

const PermissionRow = memo<PermissionRowProps>((props) => {
  const {
    kind,
    status,
    onAction,
  } = props

  const { t } = useTranslation('app')
  const meta = PERMISSION_META[kind]
  const Icon = meta.icon

  const granted = status === 'granted'
  const blocked = status === 'denied' || status === 'restricted'

  return (
    <div className="rounded-2xl border border-border bg-background2 px-4 py-3.5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex size-8 items-center justify-center rounded-full bg-background3 text-text">
            <Icon className="size-4" />
          </span>
          <p className="text-sm font-medium text-text">{ t(meta.labelKey) }</p>
        </div>

        { granted
          ? (
              <span className="flex items-center gap-1.5 rounded-full bg-successBg px-3 py-1.5 text-xs font-medium text-success">
                <Check className="size-3.5" />
                { t('permission.granted', '已授权') }
              </span>
            )
          : (
              <Button
                variant="primary"
                size="sm"
                rounded="full"
                onClick={ onAction }
              >
                { blocked
                  ? t('permission.openSettings', '去系统设置开启')
                  : t(meta.enableKey) }
              </Button>
            ) }
      </div>

      { meta.hintKey && !granted && (
        <p className="mt-2 pl-11 text-xs text-text2">{ t(meta.hintKey) }</p>
      ) }
    </div>
  )
})

PermissionRow.displayName = 'PermissionRow'

export type PermissionModalProps = {
  /** 是否打开 */
  isOpen: boolean
  /** 关闭回调 */
  onClose: () => void
  /** 展示的权限列表 */
  kinds: PermissionKind[]
  /** 各权限状态 */
  statuses: PermissionStatusMap
  /** 标题（覆盖默认通用文案） */
  title?: string
  /** 副标题（覆盖默认通用文案） */
  subtitle?: string
  /** 是否可继续 */
  canContinue: boolean
  /** 申请某权限 */
  onRequest: (kind: PermissionKind) => void
  /** 点击继续 */
  onContinue: () => void
}

type PermissionRowProps = {
  kind: PermissionKind
  status?: PermissionStatus
  onAction: () => void
}
