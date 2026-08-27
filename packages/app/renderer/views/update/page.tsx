import { UpdaterPanel } from '@/components/updater'
import { useTranslation } from 'react-i18next'

/**
 * 更新页（路由 `/update`）
 *
 * 模板演示入口：渲染通用的 {@link UpdaterPanel}
 * 实际项目里可把面板放进「设置」页，或在 Layout 里做成全局更新提示
 */
export default function UpdatePage() {
  const { t } = useTranslation('update')

  return (
    <div className="h-full overflow-y-auto px-8 py-8 lg:px-13 lg:py-10">
      <div className="max-w-180 space-y-8">
        <header className="space-y-1">
          <h1 className="text-[22px] font-medium leading-8 text-text">
            { t('title') }
          </h1>
          <p className="text-sm text-text2">
            { t('pageHint') }
          </p>
        </header>

        <UpdaterPanel />
      </div>
    </div>
  )
}
