import type { UpdateContract, UpdateInfoLite, UpdateStatus, UpdateStatusEvent } from './contract'
import { readFileSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { createIpcService } from '@ipc/core'
import { app } from 'electron'
import electronUpdater from 'electron-updater'

/**
 * electron-updater 是 CommonJS 包，本项目 `"type": "module"`，
 * 直接 `import { autoUpdater }` 在 ESM 下取不到具名导出，
 * 按官方建议从 default 导出解构（electron-builder#7976）
 */
const { autoUpdater } = electronUpdater
const UPDATER_CACHE_DIR_NAME = 'electron-app-updater'

/**
 * 应用更新 IPC 服务（主进程实现）
 *
 * 仅负责把渲染端的「检查 / 下载 / 安装」请求转交给 `autoUpdater`；
 * 事件监听与配置在 {@link initAutoUpdater} 里集中完成
 */
export const updateService = createIpcService<UpdateContract>('update', {
  async check() {
    const result = await autoUpdater.checkForUpdates()

    if (!result) {
      pendingDownloadTarget = null
      return { available: false }
    }

    pendingDownloadTarget = result.isUpdateAvailable
      ? getPendingDownloadTarget(result.updateInfo)
      : null

    return {
      available: result.isUpdateAvailable,
      info: result.isUpdateAvailable
        ? toLite(result.updateInfo)
        : undefined,
    }
  },

  async download() {
    mainProgressSnapshot = null
    pendingProgressSnapshot = null
    receivedNativeProgress = false
    startPendingDownloadPolling()
    try {
      await autoUpdater.downloadUpdate()
    }
    finally {
      stopPendingDownloadPolling()
    }
  },

  async install() {
    if (is.dev) {
      emitStatus('error', { error: 'dev mode cannot install update' })
      return
    }

    autoUpdater.quitAndInstall()
  },

  async getVersion() {
    return app.getVersion()
  },
})

/** 防止重复初始化（多次调用只生效一次） */
let initialized = false
let mainProgressSnapshot: ProgressSnapshot | null = null
let pendingDownloadTarget: PendingDownloadTarget | null = null
let pendingProgressSnapshot: ProgressSnapshot | null = null
let pendingProgressTimer: ReturnType<typeof setInterval> | null = null
let receivedNativeProgress = false

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
    autoDownload = false,
    autoInstallOnAppQuit = true,
    checkOnStart = false,
    disableDifferentialDownload = false,
  } = options

  /** 默认关闭自动下载，交由 UI 让用户确认后再 `download()`，避免静默占用带宽 */
  autoUpdater.autoDownload = autoDownload
  /** 已下载的更新在退出时自动装上 */
  autoUpdater.autoInstallOnAppQuit = autoInstallOnAppQuit
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
    emitStatus('available', { info: toLite(info) })
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
    emitStatus('downloaded', { info: toLite(info) })
  })
  autoUpdater.on('error', (error) => {
    stopPendingDownloadPolling()
    console.error('[update] auto updater error:', error)
    emitStatus('error', { error: normalizeError(error) })
  })

  if (checkOnStart) {
    /** 首检失败（如离线 / 占位 URL）只记录，不抛到顶层 */
    void autoUpdater.checkForUpdates().catch(() => {})
  }
}

/**
 * dev 模式下从 `env/.env` 解析更新源地址，取值优先级与 `build-for.mjs` 注入 publish.url 一致：
 *   UPDATE_PUBLISH_URL > GCS_PUBLIC_BASE_URL > 由 UPDATE_BUCKET/UPDATE_PREFIX 推导
 * 读不到任何一项时返回 undefined，调用方回退到 `dev-app-update.yml`
 */
function resolveDevFeedUrlFromEnv(): string | undefined {
  const env = { ...process.env, ...readEnvFile(join(process.cwd(), 'env', '.env')) }

  const bucket = env.UPDATE_BUCKET
  const prefix = (env.UPDATE_PREFIX || 'desktop').replace(/^\/+|\/+$/g, '')
  const derived = bucket
    ? `https://storage.googleapis.com/${bucket}${prefix
      ? `/${prefix}`
      : ''}`
    : ''

  return env.UPDATE_PUBLISH_URL || env.GCS_PUBLIC_BASE_URL || derived || undefined
}

/** 极简 .env 解析（仅 dev 用，避免为此引入运行时依赖）；文件不存在或出错返回空对象 */
function readEnvFile(path: string): Record<string, string> {
  try {
    const result: Record<string, string> = {}

    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#'))
        continue

      const eq = trimmed.indexOf('=')
      if (eq === -1)
        continue

      const key = trimmed.slice(0, eq).trim()
      let value = trimmed.slice(eq + 1).split('#')[0].trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\'')))
        value = value.slice(1, -1)

      if (key)
        result[key] = value
    }

    return result
  }
  catch {
    return {}
  }
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
  const pendingDir = join(getAppCacheDir(), UPDATER_CACHE_DIR_NAME, 'pending')
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

function getAppCacheDir(): string {
  if (process.platform === 'win32')
    return process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')

  if (process.platform === 'darwin')
    return join(homedir(), 'Library', 'Caches')

  return process.env.XDG_CACHE_HOME || join(homedir(), '.cache')
}

function getPendingDownloadTarget(info: UpdateInfoWithFiles): PendingDownloadTarget | null {
  const files = Array.isArray(info.files)
    ? info.files
    : []
  const updateFile = files.find(file => typeof file.url === 'string' && isSupportedUpdateFile(file.url))

  if (updateFile?.url) {
    return {
      fileName: getFileName(updateFile.url),
      total: typeof updateFile.size === 'number'
        ? updateFile.size
        : 0,
    }
  }

  if (typeof info.path === 'string' && isSupportedUpdateFile(info.path)) {
    return {
      fileName: getFileName(info.path),
      total: typeof info.size === 'number'
        ? info.size
        : 0,
    }
  }

  return null
}

function isSupportedUpdateFile(urlOrPath: string): boolean {
  const name = getFileName(urlOrPath)
  return getPlatformUpdateExtensions().some(extension => name.endsWith(extension))
}

function getPlatformUpdateExtensions(): string[] {
  if (process.platform === 'darwin')
    return ['.zip']

  if (process.platform === 'win32')
    return ['.exe']

  return ['.AppImage']
}

function getFileName(urlOrPath: string): string {
  try {
    return basename(decodeURIComponent(new URL(urlOrPath).pathname))
  }
  catch {
    return basename(decodeURIComponent(urlOrPath))
  }
}

/** 广播一条 `status` 事件（不带 target = 推送到所有窗口） */
function emitStatus(status: UpdateStatus, extra?: Omit<UpdateStatusEvent, 'status'>): void {
  updateService.emit('status', { status, ...extra })
}

/** 把 electron-updater 的 UpdateInfo 归一化为可序列化的精简结构 */
function toLite(info: { version: string, releaseDate?: string, releaseNotes?: unknown }): UpdateInfoLite {
  return {
    version: info.version,
    releaseDate: info.releaseDate,
    releaseNotes: typeof info.releaseNotes === 'string'
      ? info.releaseNotes
      : undefined,
  }
}

/** 统一错误信息提取，只把安全、短文本传给渲染端 */
function normalizeError(error: unknown): string {
  const message = error instanceof Error
    ? error.message
    : String(error ?? '')

  if (message.includes('Cannot find channel') || message.includes('404 Not Found'))
    return 'update feed not found'

  if (message.includes('sha512') || message.includes('checksum'))
    return 'update package verification failed'

  if (message.includes('net::') || message.includes('ENOTFOUND') || message.includes('ECONNREFUSED'))
    return 'update server is unreachable'

  return 'update failed'
}

/** {@link initAutoUpdater} 配置项 */
export interface InitAutoUpdaterOptions {
  /**
   * 发现新版本后是否自动开始下载
   * @default false
   */
  autoDownload?: boolean
  /**
   * 已下载的更新是否在应用退出时自动安装
   * @default true
   */
  autoInstallOnAppQuit?: boolean
  /**
   * 是否在初始化后立即检查一次更新
   * @default false
   */
  checkOnStart?: boolean
  /**
   * 是否禁用增量（blockmap）下载，强制每次全量
   * 仅当更新服务器不支持 HTTP Range 时才需要
   * @default false
   */
  disableDifferentialDownload?: boolean
}

type ProgressSnapshot = {
  transferred: number
  timestamp: number
}

type PendingDownloadTarget = {
  fileName: string
  total: number
}

type UpdateInfoWithFiles = {
  files?: Array<{
    size?: number
    url?: string
  }>
  path?: string
  size?: number
}
