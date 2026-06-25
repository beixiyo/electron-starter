import { Button, Modal, ProgressBar } from 'comps'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  checkUpdate,
  closeUpdaterModal,
  downloadUpdate,
  installUpdate,
  updaterAvailable,
  useUpdaterState,
} from '@/store/updaterStore'
import { parseReleaseNotes } from './parseReleaseNotes'

/**
 * 全局应用更新弹窗
 *
 * 受控于 {@link updaterStore}：后台轮询发现新版本会自动打开，也可由入口手动打开。
 * 按状态机展示「检查中 / 已是最新 / 待下载（版本·大小·更新日志）/ 下载进度 / 待安装 / 出错」，
 * 并提供对应动作。仅 Electron 桌面端渲染。在应用根组件挂载一次即可。
 */
export const UpdaterModal = memo(() => {
  const { t, i18n } = useTranslation('update')
  const { status, info, progress, error, currentVersion, modalOpen } = useUpdaterState()

  if (!updaterAvailable)
    return null

  /** 按当前界面语言从多语言更新日志里取对应段落 */
  const releaseNotes = parseReleaseNotes(info?.releaseNotes, i18n.language)

  return (
    <Modal
      isOpen={ modalOpen }
      onClose={ closeUpdaterModal }
      titleText={ t('modal.title') }
      width={ 460 }
      clickOutsideClose={ false }
      footer={ renderFooter() }
    >
      { renderBody() }
    </Modal>
  )

  function renderBody() {
    switch (status) {
      case 'checking':
        return <CenterHint title={ t('modal.checking') } />

      case 'not-available':
        return (
          <CenterHint
            title={ t('modal.upToDate') }
            desc={ t('currentVersion', { version: currentVersion }) }
          />
        )

      case 'error':
        return (
          <CenterHint
            tone="danger"
            title={ t('errorHint') }
            desc={ error ?? undefined }
          />
        )

      case 'downloading':
        return (
          <div className="flex flex-col gap-5 py-1">
            <VersionLine version={ info?.version } />

            <div className="flex flex-col gap-2">
              <ProgressBar value={ (progress?.percent ?? 0) / 100 } height={ 8 } />
              <div className="flex items-center justify-between text-xs text-text2">
                <span>{ `${Math.round(progress?.percent ?? 0)}%` }</span>
                <span>
                  { formatBytes(progress?.transferred) }
                  { progress?.total
                    ? ` / ${formatBytes(progress.total)}`
                    : '' }
                  { formatSpeed(progress?.bytesPerSecond)
                    ? ` · ${formatSpeed(progress?.bytesPerSecond)}`
                    : '' }
                </span>
              </div>
            </div>
          </div>
        )

      case 'downloaded':
        return (
          <div className="flex flex-col gap-4 py-1">
            <VersionLine version={ info?.version } badge={ t('status.downloaded') } />
            <p className="text-sm text-text2">{ t('modal.restartHint') }</p>
            <Changelog notes={ releaseNotes } label={ t('modal.changelog') } />
          </div>
        )

      case 'available':
        return (
          <div className="flex flex-col gap-4 py-1">
            <VersionLine version={ info?.version } />

            <div className="flex items-center gap-4 text-xs text-text2">
              { formatBytes(info?.size) && (
                <Meta label={ t('modal.size') } value={ formatBytes(info?.size) } />
              ) }
              { formatDate(info?.releaseDate) && (
                <Meta label={ t('modal.releaseDate') } value={ formatDate(info?.releaseDate) } />
              ) }
            </div>

            <Changelog notes={ releaseNotes } label={ t('modal.changelog') } />
          </div>
        )

      default:
        /** idle：弹窗打开时通常已触发检查，这里给一条中性提示兜底 */
        return <CenterHint title={ t('modal.checking') } />
    }
  }

  function renderFooter() {
    switch (status) {
      case 'available':
        return (
          <FooterBar>
            <Button variant="ghost" onClick={ closeUpdaterModal }>{ t('actions.later') }</Button>
            <Button variant="primary" onClick={ () => downloadUpdate() }>{ t('actions.download') }</Button>
          </FooterBar>
        )

      case 'downloading':
        return (
          <FooterBar>
            <Button variant="ghost" onClick={ closeUpdaterModal }>{ t('actions.background') }</Button>
            <Button variant="primary" loading disabled>{ t('status.downloading') }</Button>
          </FooterBar>
        )

      case 'downloaded':
        return (
          <FooterBar>
            <Button variant="ghost" onClick={ closeUpdaterModal }>{ t('actions.later') }</Button>
            <Button variant="primary" onClick={ () => installUpdate() }>{ t('actions.install') }</Button>
          </FooterBar>
        )

      case 'error':
        return (
          <FooterBar>
            <Button variant="ghost" onClick={ closeUpdaterModal }>{ t('actions.close') }</Button>
            <Button variant="primary" onClick={ () => checkUpdate() }>{ t('actions.retry') }</Button>
          </FooterBar>
        )

      case 'checking':
        return (
          <FooterBar>
            <Button variant="ghost" onClick={ closeUpdaterModal }>{ t('actions.close') }</Button>
          </FooterBar>
        )

      default:
        return (
          <FooterBar>
            <Button variant="primary" onClick={ closeUpdaterModal }>{ t('actions.close') }</Button>
          </FooterBar>
        )
    }
  }
})

UpdaterModal.displayName = 'UpdaterModal'

/** 醒目展示目标版本号 */
const VersionLine = memo<{ version?: string, badge?: string }>(({ version, badge }) => (
  <div className="flex items-center gap-3">
    <span className="text-2xl font-semibold tracking-tight text-text">{ `v${version ?? ''}` }</span>
    { badge && (
      <span className="rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-medium text-brand">{ badge }</span>
    ) }
  </div>
))
VersionLine.displayName = 'VersionLine'

/** 元信息小项（大小 / 发布时间） */
const Meta = memo<{ label: string, value: string }>(({ label, value }) => (
  <span className="flex items-center gap-1">
    <span className="text-text2/60">{ label }</span>
    <span className="font-medium text-text2">{ value }</span>
  </span>
))
Meta.displayName = 'Meta'

/** 更新日志区块；releaseNotes 为空则不渲染 */
const Changelog = memo<{ notes?: string, label: string }>(({ notes, label }) => {
  if (!notes?.trim())
    return null

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-text2/60">{ label }</span>
      <div className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-2xl bg-background2 px-4 py-3 text-sm leading-relaxed text-text2">
        { notes.trim() }
      </div>
    </div>
  )
})
Changelog.displayName = 'Changelog'

/** 居中提示（检查中 / 已是最新 / 出错） */
const CenterHint = memo<{ title: string, desc?: string, tone?: 'default' | 'danger' }>(({ title, desc, tone = 'default' }) => (
  <div className="flex flex-col items-center gap-2 py-8 text-center">
    <span className={ `text-base font-medium ${tone === 'danger'
      ? 'text-danger'
      : 'text-text'}` }
    >
      { title }
    </span>
    { desc && <span className="text-sm text-text2">{ desc }</span> }
  </div>
))
CenterHint.displayName = 'CenterHint'

const FooterBar = memo<React.PropsWithChildren>(({ children }) => (
  <div className="flex items-center justify-end gap-3">{ children }</div>
))
FooterBar.displayName = 'FooterBar'

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0)
    return ''
  const mb = bytes / (1024 * 1024)
  return mb >= 1024
    ? `${(mb / 1024).toFixed(2)} GB`
    : `${mb.toFixed(1)} MB`
}

function formatSpeed(bytesPerSecond?: number): string {
  if (!bytesPerSecond || bytesPerSecond <= 0)
    return ''
  const mbps = bytesPerSecond / (1024 * 1024)
  return mbps >= 1
    ? `${mbps.toFixed(1)} MB/s`
    : `${Math.round(bytesPerSecond / 1024)} KB/s`
}

function formatDate(iso?: string): string {
  return iso
    ? iso.slice(0, 10)
    : ''
}
