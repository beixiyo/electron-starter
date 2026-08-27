import { useUpdater } from '@/hooks'
import { formatFileSize } from '@jl-org/tool'
import { Button, Message, ProgressBar } from 'comps'
import { AlertTriangle, CheckCircle2, DownloadCloud, RefreshCw, RotateCw } from 'lucide-react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from 'utils'

/**
 * 应用更新面板（通用展示组件）
 *
 * 自带 {@link useUpdater} 逻辑，无需外部传状态：展示当前版本、检查 / 下载 / 安装入口与进度
 * 逻辑与 UI 解耦——要换皮只改本组件，复用 `useUpdater` 即可
 */
export const UpdaterPanel = memo<UpdaterPanelProps>((props) => {
  const { className, style, ...rest } = props
  const { t } = useTranslation('update')
  const {
    available,
    currentVersion,
    status,
    info,
    progress,
    error,
    check,
    download,
    install,
  } = useUpdater()

  const handleCheck = async () => {
    const outcome = await check()
    /** 事件已驱动状态，这里只在「已是最新」时补一条轻提示 */
    if (outcome && !outcome.available) Message.success(t('upToDate'))
  }

  return (
    <section
      className={ cn(
        'flex flex-col gap-4 rounded-2xl bg-background2 p-6 shadow-[0_8px_30px_rgba(0,0,0,0.06)]',
        className,
      ) }
      style={ style }
      { ...rest }
    >
      { /* 头部：标题 + 当前版本 */ }
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-text">
            { t('title') }
          </h2>
          <p className="text-sm text-text2">
            { available
              ? t('currentVersion', { version: currentVersion || '—' })
              : t('webUnsupported') }
          </p>
        </div>
        { available && <StatusBadge status={ status } /> }
      </header>

      { available && (
        <>
          { /* 新版本信息 */ }
          { (status === 'available' || status === 'downloaded') && info && (
            <div className="rounded-xl bg-background3 px-4 py-3">
              <p className="text-sm font-medium text-text">
                { t('newVersion', { version: info.version }) }
              </p>
              { info.releaseNotes && (
                <p className="mt-1 whitespace-pre-line text-xs text-text2">
                  { info.releaseNotes }
                </p>
              ) }
            </div>
          ) }

          { /* 下载进度 */ }
          { status === 'downloading' && (
            <div className="space-y-2">
              <ProgressBar value={ (progress?.percent ?? 0) / 100 } height={ 6 } />
              <div className="flex justify-between text-xs text-text2">
                <span>
                  { Math.round(progress?.percent ?? 0) }
                  %
                  { ' · ' }
                  { formatFileSizeText(progress?.transferred ?? 0) }
                  /
                  { formatFileSizeText(progress?.total ?? 0) }
                </span>
                <span>{ formatSpeed(progress?.bytesPerSecond ?? 0) }</span>
              </div>
            </div>
          ) }

          { /* 错误信息 */ }
          { status === 'error' && error && (
            <p className="text-sm text-danger">
              { t('errorHint', { error }) }
            </p>
          ) }

          { /* 操作区：按状态切换主操作 */ }
          <footer className="flex justify-end">
            { status === 'downloaded'
              ? (
                <Button variant="primary" leftIcon={ <RotateCw size={ 16 } /> } onClick={ install }>
                  { t('actions.install') }
                </Button>
              )
              : status === 'available'
              ? (
                <Button variant="primary" leftIcon={ <DownloadCloud size={ 16 } /> } onClick={ download }>
                  { t('actions.download') }
                </Button>
              )
              : (
                <Button
                  variant="secondary"
                  leftIcon={ <RefreshCw size={ 16 } /> }
                  loading={ status === 'checking' }
                  disabled={ status === 'downloading' }
                  onClick={ handleCheck }
                >
                  { status === 'error'
                    ? t('actions.retry')
                    : t('actions.check') }
                </Button>
              ) }
          </footer>
        </>
      ) }
    </section>
  )
})

UpdaterPanel.displayName = 'UpdaterPanel'

/** 右上角状态徽标 */
const StatusBadge = memo<{ status: string }>(({ status }) => {
  const { t } = useTranslation('update')

  if (status === 'downloaded') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-success">
        <CheckCircle2 size={ 14 } />
        { t('status.downloaded') }
      </span>
    )
  }

  if (status === 'error') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-danger">
        <AlertTriangle size={ 14 } />
        { t('status.error') }
      </span>
    )
  }

  return (
    <span className="text-xs text-text3">
      { t(`status.${status}`) }
    </span>
  )
})

StatusBadge.displayName = 'StatusBadge'

/** 把字节/秒格式化为人类可读速率 */
function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond <= 0) return '0 KB/s'

  return `${formatFileSizeText(bytesPerSecond)}/s`
}

function formatFileSizeText(bytes: number): string {
  if (bytes <= 0) return '0 KB'

  const { recommended } = formatFileSize({ value: bytes, unit: 'byte' })
  const unit = recommended.unit.toUpperCase()

  if (recommended.unit === 'mb' || recommended.unit === 'gb' || recommended.unit === 'tb') return `${recommended.value.toFixed(1)} ${unit}`

  if (recommended.unit === 'kb') return `${Math.round(recommended.value)} ${unit}`

  if (recommended.unit === 'byte') return `${Math.round(recommended.value)} B`

  return `${Math.round(recommended.value)} bit`
}

export type UpdaterPanelProps = React.HTMLAttributes<HTMLElement>
