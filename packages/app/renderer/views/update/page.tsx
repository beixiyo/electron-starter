import { useTranslation } from 'react-i18next'
import { UpdaterPanel } from '@/components/updater'

/**
 * 更新页（路由 `/update`）
 *
 * 模板演示入口：渲染通用的 {@link UpdaterPanel}。
 * 实际项目里可把面板放进「设置」页，或在 Layout 里做成全局更新提示
 */
export default function UpdatePage() {
  const { t } = useTranslation('update')

  return (
    <div className="min-h-full bg-background2 px-8 py-10">
      <div className="mx-auto max-w-2xl space-y-8">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold text-text">
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
