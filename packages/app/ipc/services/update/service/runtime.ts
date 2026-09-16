import type { UpdateContract, UpdateStatus, UpdateStatusEvent } from '../contract'
import { classifyUpdateError } from '../error'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { createIpcService } from '@ipc/core'
import { loadEnv } from '@jl-org/tool/node'
import { getUpdaterCacheStorageAreaPath } from '@main/storage'
import { createMainDiagnosticLogger } from '@main/logging'
import type { InitAutoUpdaterOptions, PendingDownloadTarget, ProgressSnapshot, UpdateInfoWithFiles } from './types'
import { getPendingDownloadTarget, isSupportedUpdateFile, toLite } from './updateInfo'
import { app } from 'electron'
import electronUpdater from 'electron-updater'

/**
 * electron-updater 是 CommonJS 包，本项目 `"type": "module"`，
 * 直接 `import { autoUpdater }` 在 ESM 下取不到具名导出，
 * 按官方建议从 default 导出解构（electron-builder#7976）
 */
const { autoUpdater } = electronUpdater
const log = createMainDiagnosticLogger('update.service')

/**
 * 应用更新 IPC 服务（主进程实现）
 *
 * 仅负责把渲染端的「检查 / 下载 / 安装」请求转交给 `autoUpdater`；
 * 事件监听与配置在 {@link initAutoUpdater} 里集中完成
 */
export const updateService = createIpcService<UpdateContract>('update', {
  mainHandle: {
    async check() {
      const result = await autoUpdater.checkForUpdates()

      if (!result) {
        pendingDownloadTarget = null
        return { available: false }
      }

      pendingDownloadTarget = result.isUpdateAvailable
        ? getPendingDownloadTarget(result.updateInfo)
        : null

      if (!result.isUpdateAvailable) latestAvailableUpdate = null

      return {
        available: result.isUpdateAvailable,
        info: result.isUpdateAvailable
          ? toLite(result.updateInfo)
          : undefined,
      }
    },

    async download() {
      await downloadLatestAvailableUpdate('manual')
    },

    async install() {
      if (is.dev) {
        emitStatus('error', { error: 'unknown' })
        return
      }

      if (!installableVersion || latestAvailableUpdate?.version !== installableVersion) {
        const latestInfo = latestAvailableUpdate
          ? { info: toLite(latestAvailableUpdate) }
          : undefined
        emitStatus('available', latestInfo)
        return
      }
      autoUpdater.quitAndInstall()
    },

    async getVersion() {
      return app.getVersion()
    },
  },
})

/** 防止重复初始化（多次调用只生效一次） */
let initialized = false
let mainProgressSnapshot: ProgressSnapshot | null = null
let pendingDownloadTarget: PendingDownloadTarget | null = null
let pendingProgressSnapshot: ProgressSnapshot | null = null
let pendingProgressTimer: ReturnType<typeof setInterval> | null = null
let receivedNativeProgress = false
let autoDownloadEnabled = true
let installOnAppQuitWhenReady = true
let latestAvailableUpdate: UpdateInfoWithFiles & { version: string, releaseDate?: string, releaseNotes?: unknown } | null = null
let activeDownloadVersion: string | null = null
let installableVersion: string | null = null

/**
 * 初始化自动更新：配置 `autoUpdater` 并把其事件桥接到 `status` / `progress` IPC 事件
 * 在 `main/index.ts` 应用就绪、主窗口创建后调用一次即可
 *
 * @example
 * ```ts
 * import { initAutoUpdater } from '@ipc/services/update/service'
 * initAutoUpdater({ checkOnStart: true })
 * ```
 */
export function initAutoUpdater(options: InitAutoUpdaterOptions = {}): void {
  if (initialized)
    return
  initialized = true

  const {
    autoDownload = true,
    autoInstallOnAppQuit = true,
    checkOnStart = false,
    disableDifferentialDownload = false,
    initialCheckDelayMs = 10_000,
    pollIntervalMs = 4 * 60 * 60 * 1000,
  } = options

  /** 服务自行串行下载，确保常驻期间只把最新完整包标记为可安装。 */
  autoDownloadEnabled = autoDownload
  installOnAppQuitWhenReady = autoInstallOnAppQuit
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  /** 增量下载默认开启；个别服务器/代理不支持 HTTP Range 时可置 true 强制全量 */
  autoUpdater.disableDifferentialDownload = disableDifferentialDownload

  /**
   * 开发环境 `app.isPackaged` 为 false，updater 默认不工作；
   * 置 `forceDevUpdateConfig` 让它在 dev 下激活
   *
   * 更新源优先从 env 取（与打包时注入 publish.url 同一套规则），用 `setFeedURL` 设进去，
   * 这样 dev 检查更新也走 env，不必手改 `dev-app-update.yml`；env 没配时回退读该 yml
   */
  if (is.dev) {
    autoUpdater.forceDevUpdateConfig = true

    const devFeedUrl = resolveDevFeedUrlFromEnv()
    if (devFeedUrl) {
      autoUpdater.setFeedURL({ provider: 'generic', url: devFeedUrl })
      console.log(`[update] dev feed url from env: ${devFeedUrl}`)
    }
  }

  autoUpdater.on('checking-for-update', () => emitStatus('checking'))

  autoUpdater.on('update-available', (info) => {
    pendingDownloadTarget = getPendingDownloadTarget(info)
    latestAvailableUpdate = info
    if (installableVersion && installableVersion !== info.version) autoUpdater.autoInstallOnAppQuit = false
    installableVersion = installableVersion === info.version
      ? installableVersion
      : null
    log.info('event.update-available', 'auto updater update available', { version: info.version })
    emitStatus('available', { info: toLite(info) })
    if (autoDownloadEnabled) void downloadLatestAvailableUpdate('automatic')
  })

  autoUpdater.on('update-not-available', () => emitStatus('not-available'))

  autoUpdater.on('download-progress', (progress) => {
    receivedNativeProgress = true
    const timestamp = Date.now()
    const fallbackBytesPerSecond = getFallbackBytesPerSecond(
      progress.transferred,
      mainProgressSnapshot,
      timestamp,
    )
    const bytesPerSecond = progress.bytesPerSecond > 0
      ? progress.bytesPerSecond
      : fallbackBytesPerSecond

    mainProgressSnapshot = {
      timestamp,
      transferred: progress.transferred,
    }

    updateService.emit('progress', {
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    stopPendingDownloadPolling()
    const isLatestKnownUpdate = latestAvailableUpdate?.version === info.version
    installableVersion = isLatestKnownUpdate
      ? info.version
      : null
    autoUpdater.autoInstallOnAppQuit = Boolean(installableVersion && installOnAppQuitWhenReady)
    if (isLatestKnownUpdate) emitStatus('downloaded', { info: toLite(info) })
    else if (latestAvailableUpdate) emitStatus('available', { info: toLite(latestAvailableUpdate) })
  })

  autoUpdater.on('error', (error) => {
    stopPendingDownloadPolling()
    const errorCode = classifyUpdateError(error)
    console.error('[update] auto updater error:', errorCode)
    emitStatus('error', { error: errorCode })
  })

  /** 静默检查：失败（如离线 / 占位 URL）只忽略，不抛到顶层；结果通过 status 事件驱动 UI（含自动弹窗） */
  const silentCheck = (): void => {
    void autoUpdater.checkForUpdates().catch(() => {})
  }

  if (checkOnStart)
    silentCheck()

  /** 启动后延迟首检：避开启动高峰，不阻塞窗口呈现 */
  if (initialCheckDelayMs > 0)
    setTimeout(silentCheck, initialCheckDelayMs)

  /** 周期轮询：长驻应用期间定时探测新版本（设 0 关闭） */
  if (pollIntervalMs > 0)
    setInterval(silentCheck, pollIntervalMs)
}

/** 串行下载当前已知最新版本；旧下载结束后再覆盖为轮询期间发现的新版本。 */
async function downloadLatestAvailableUpdate(source: 'automatic' | 'manual'): Promise<void> {
  const target = latestAvailableUpdate
  if (!target || activeDownloadVersion) {
    if (activeDownloadVersion) autoUpdater.autoInstallOnAppQuit = false
    return
  }

  activeDownloadVersion = target.version
  installableVersion = null
  autoUpdater.autoInstallOnAppQuit = false
  mainProgressSnapshot = null
  pendingProgressSnapshot = null
  receivedNativeProgress = false
  startPendingDownloadPolling()
  log.info('download.start', 'update download started', { source, version: target.version })

  try {
    await autoUpdater.downloadUpdate()
  }
  finally {
    stopPendingDownloadPolling()
    activeDownloadVersion = null
    if (latestAvailableUpdate && latestAvailableUpdate.version !== target.version) void downloadLatestAvailableUpdate('automatic')
  }
}

/**
 * dev 模式下从 `env/.env.development` 解析更新源地址，取值优先级与 `build-for.mjs` 注入 publish.url 一致：
 *   UPDATE_PUBLISH_URL > GCS_PUBLIC_BASE_URL > 由 UPDATE_BUCKET/UPDATE_PREFIX 推导
 * 读不到任何一项时返回 undefined，调用方回退到 `dev-app-update.yml`
 */
function resolveDevFeedUrlFromEnv(): string | undefined {
  loadEnv({ envDir: join(process.cwd(), 'env'), envPath: '.env.development' })

  const bucket = process.env.UPDATE_BUCKET
  const prefix = (process.env.UPDATE_PREFIX || 'desktop').replace(/^\/+|\/+$/g, '')
  const derived = bucket
    ? `https://storage.googleapis.com/${bucket}${prefix
      ? `/${prefix}`
      : ''}`
    : ''

  return process.env.UPDATE_PUBLISH_URL || process.env.GCS_PUBLIC_BASE_URL || derived || undefined
}

function getFallbackBytesPerSecond(
  transferred: number,
  previous: ProgressSnapshot | null,
  timestamp: number,
): number {
  if (!previous)
    return 0

  const deltaBytes = transferred - previous.transferred
  const deltaSeconds = (timestamp - previous.timestamp) / 1000

  if (deltaBytes <= 0 || deltaSeconds <= 0)
    return 0

  return Math.round(deltaBytes / deltaSeconds)
}

function startPendingDownloadPolling(): void {
  stopPendingDownloadPolling()
  pendingProgressTimer = setInterval(() => {
    void emitPendingDownloadProgress()
  }, 500)
  void emitPendingDownloadProgress()
}

function stopPendingDownloadPolling(): void {
  if (!pendingProgressTimer)
    return

  clearInterval(pendingProgressTimer)
  pendingProgressTimer = null
  pendingProgressSnapshot = null
}

/**
 * 部分平台 / 开发模式下 electron-updater 可能不触发 download-progress；
 * 此时用 pending 安装包的真实落盘大小补一条进度来源
 */
async function emitPendingDownloadProgress(): Promise<void> {
  if (receivedNativeProgress)
    return

  const pendingFile = await findPendingDownloadFile()
  if (!pendingFile)
    return

  const stats = await stat(pendingFile).catch(() => null)
  if (!stats || stats.size <= 0)
    return

  const timestamp = Date.now()
  const bytesPerSecond = getFallbackBytesPerSecond(
    stats.size,
    pendingProgressSnapshot,
    timestamp,
  )
  const total = pendingDownloadTarget?.total && pendingDownloadTarget.total > 0
    ? pendingDownloadTarget.total
    : stats.size
  const percent = total > 0
    ? Math.min((stats.size / total) * 100, 100)
    : 0

  pendingProgressSnapshot = {
    timestamp,
    transferred: stats.size,
  }

  updateService.emit('progress', {
    bytesPerSecond,
    percent,
    total,
    transferred: stats.size,
  })
}

async function findPendingDownloadFile(): Promise<string | null> {
  const pendingDir = getUpdaterCacheStorageAreaPath('updater-cache')
  const targetFileName = pendingDownloadTarget?.fileName
  if (targetFileName) {
    const targetPath = join(pendingDir, `temp-${targetFileName}`)
    const targetStats = await stat(targetPath).catch(() => null)
    if (targetStats?.isFile())
      return targetPath
  }

  const entries = await readdir(pendingDir, { withFileTypes: true }).catch(() => [])
  const tempInstaller = entries.find(entry => (
    entry.isFile()
    && entry.name.startsWith('temp-')
    && isSupportedUpdateFile(entry.name)
  ))

  return tempInstaller
    ? join(pendingDir, tempInstaller.name)
    : null
}

/** 广播一条 `status` 事件（不带 target = 推送到所有窗口） */
function emitStatus(status: UpdateStatus, extra?: Omit<UpdateStatusEvent, 'status'>): void {
  updateService.emit('status', { status, ...extra })
}
