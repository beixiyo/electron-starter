import type { LogLevel } from '@jl-org/log'
import { listenElectronLogs, NodeLogger } from '@jl-org/log/node'
import { getAppStorageAreaPath } from '@main/storage'
import type { IpcMain } from 'electron'
import { app } from 'electron'
import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

/** 日志根目录保留的最近 session 目录数（含当前 session） */
const MAX_SESSION_LOG_DIRS = 100

/** 错误对象上允许写入日志的自有属性白名单 */
const ERROR_DETAIL_KEYS = ['code', 'status', 'statusCode', 'errno', 'syscall'] as const

/** `cause` 链最大展开层数 */
const MAX_ERROR_CAUSE_DEPTH = 3

/** 单条错误文本写入日志的长度上限 */
const MAX_DETAIL_LENGTH = 4000

let logger: NodeLogger | null = null
let sessionId: string | null = null
let stopRendererLogListener: (() => void) | null = null
let initialized = false

/** 初始化主进程与 renderer 共用的 session 级诊断日志 */
export function initAppLogging(ipcMain: IpcMain): void {
  if (initialized) return
  initialized = true

  stopRendererLogListener = listenElectronLogs(ipcMain, getAppLogger())

  app.once('will-quit', () => {
    stopRendererLogListener?.()
    void closeAppLogger()
  })

  createMainDiagnosticLogger('app.lifecycle').debug(
    'logging.ready',
    'diagnostic log initialized',
    {
      logDir: getDiagnosticLogDir(),
      debug: isDiagnosticDebugEnabled(),
    },
  )

  void pruneStaleSessionLogDirs()
}

/**
 * 启动时修剪日志根目录的历史 session 目录，仅保留最近 MAX_SESSION_LOG_DIRS 个
 * 目录名 sessionYYYYMMDD-HHMMSS-pid 按字典序即时间序；永不删除当前 session；
 * 任何失败只 warn，不阻塞启动
 */
async function pruneStaleSessionLogDirs(): Promise<void> {
  const log = createMainDiagnosticLogger('app.lifecycle')

  try {
    const root = getDiagnosticLogRootDir()
    const entries = await readdir(root, { withFileTypes: true })
    const sessionDirs = entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('session'))
      .map((entry) => entry.name)
      .sort()

    const currentSession = getSessionId()
    const staleDirs = sessionDirs
      .slice(0, Math.max(0, sessionDirs.length - MAX_SESSION_LOG_DIRS))
      .filter((name) => name !== currentSession)

    if (staleDirs.length === 0) return

    let removedCount = 0
    for (const name of staleDirs) {
      const removed = await rm(join(root, name), { recursive: true, force: true })
        .then(() => true)
        .catch(() => false)

      if (removed) removedCount += 1
    }

    log.info('logging.prune', 'pruned stale diagnostic session directories', {
      removedCount,
      failedCount: staleDirs.length - removedCount,
      keptCount: sessionDirs.length - removedCount,
    })
  }
  catch (error) {
    log.warn('logging.prune-failed', 'failed to prune diagnostic session directories', {
      error: error instanceof Error
        ? error.message
        : String(error),
    })
  }
}

/** 创建带稳定 module/event 字段的主进程日志入口 */
export function createMainDiagnosticLogger(module: MainDiagnosticModule) {
  return {
    info: (event: string, message: string, meta?: DiagnosticMeta) => {
      writeDiagnosticLog('info', module, event, message, meta)
    },
    success: (event: string, message: string, meta?: DiagnosticMeta) => {
      writeDiagnosticLog('success', module, event, message, meta)
    },
    warn: (event: string, message: string, meta?: DiagnosticMeta) => {
      writeDiagnosticLog('warn', module, event, message, meta)
    },
    error: (event: string, message: string, error?: unknown, meta?: DiagnosticMeta) => {
      writeDiagnosticLog('error', module, event, message, meta, error)
    },
    debug: (event: string, message: string, meta?: DiagnosticMeta) => {
      writeDiagnosticLog('debug', module, event, message, meta)
    },
  }
}

/** 当前启动 session 的日志目录 */
export function getDiagnosticLogDir(): string {
  return getAppStorageAreaPath('diagnostic-logs', getSessionId())
}

/** 所有启动 session 的日志根目录 */
export function getDiagnosticLogRootDir(): string {
  return getAppStorageAreaPath('diagnostic-logs')
}

async function closeAppLogger(): Promise<void> {
  await logger?.close()
}

function getAppLogger(): NodeLogger {
  if (logger) return logger

  logger = new NodeLogger({
    prefix: 'electron-app',
    debug: isDiagnosticDebugEnabled(),
    file: {
      path: join(getDiagnosticLogDir(), 'app.jsonl'),
      format: 'jsonl',
      size: '10M',
      interval: '1d',
      maxFiles: 30,
      compress: false,
      meta: () => ({
        sessionId: getSessionId(),
        appVersion: app.getVersion(),
        packaged: app.isPackaged,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
        process: 'main',
      }),
    },
  })

  return logger
}

function writeDiagnosticLog(
  level: LogLevel,
  module: MainDiagnosticModule,
  event: string,
  message: string,
  meta?: DiagnosticMeta,
  error?: unknown,
): void {
  const config = {
    prefix: module,
    meta: {
      module,
      event,
      ...meta,
    },
  }

  switch (level) {
    case 'info':
      getAppLogger().info(message, config)
      return
    case 'success':
      getAppLogger().success(message, config)
      return
    case 'warn':
      getAppLogger().warn(message, config)
      return
    case 'error':
      getAppLogger().error(message, toErrorDetail(error), config)
      return
    case 'debug':
      getAppLogger().debug(message, config)
      return
    case 'log':
      getAppLogger().log(message)
  }
}

/**
 * 把任意抛出物转成可 JSON 序列化的诊断对象
 *
 * Error 的 name、message、stack 都是不可枚举属性，且错误对象可能附带响应体、请求头等
 * 用户数据。这里只保留定位错误所需字段，并限制 cause 链深度，避免日志泄露或失控膨胀
 */
export function toErrorDetail(error: unknown): unknown {
  return toErrorDetailAtDepth(error, 0)
}

function toErrorDetailAtDepth(error: unknown, depth: number): unknown {
  if (error == null)
    return error

  if (typeof error !== 'object') {
    if (typeof error === 'string')
      return truncate(error)

    return String(error)
  }

  const source = error as Record<string, unknown>
  const detail: Record<string, unknown> = { name: readString(source, 'name') ?? getDefaultErrorName(error) }

  const message = readString(source, 'message')
  if (message !== undefined)
    detail.message = message

  const stack = readString(source, 'stack')
  if (stack !== undefined)
    detail.stack = stack

  for (const key of ERROR_DETAIL_KEYS) {
    const value = readSafeProperty(source, key)
    if (value === undefined)
      continue

    if (typeof value === 'string')
      detail[key] = truncate(value)
    else if (typeof value === 'number' || typeof value === 'boolean')
      detail[key] = value
  }

  const cause = readSafeProperty(source, 'cause')
  if (cause !== undefined && depth < MAX_ERROR_CAUSE_DEPTH)
    detail.cause = toErrorDetailAtDepth(cause, depth + 1)

  return detail
}

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = readSafeProperty(source, key)
  if (typeof value === 'string')
    return truncate(value)

  return undefined
}

function getDefaultErrorName(error: object): string {
  if (error instanceof Error)
    return 'Error'

  return 'ThrownValue'
}

function readSafeProperty(source: Record<string, unknown>, key: string): unknown {
  try {
    return source[key]
  }
  catch {
    return undefined
  }
}

function truncate(value: string): string {
  if (value.length <= MAX_DETAIL_LENGTH)
    return value

  return `${value.slice(0, MAX_DETAIL_LENGTH)}...`
}

function getSessionId(): string {
  if (sessionId) return sessionId

  const date = new Date()
  sessionId = [
    'session',
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
    '-',
    process.pid,
  ].join('')

  return sessionId
}

function isDiagnosticDebugEnabled(): boolean {
  const globalDebug = (globalThis as { __ELECTRON_APP_LOG_DEBUG__?: unknown }).__ELECTRON_APP_LOG_DEBUG__
  return globalDebug === true
    || process.env.ELECTRON_APP_LOG_DEBUG === '1'
    || process.env.ELECTRON_APP_LOG_DEBUG === 'true'
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** 主进程诊断日志模块名 */
export type MainDiagnosticModule =
  | 'app.lifecycle'
  | 'app.power'
  | 'global-toast'
  | 'ipc.service'
  | 'meeting.detection'
  | 'native.bridge'
  | 'native.recorder'
  | 'native.recording'
  | 'permission'
  | 'permission.drag-guide'
  | 'recording.recovery'
  | 'recording.state'
  | 'screenshot'
  | 'shortcut.runtime'
  | 'storage'
  | 'voice-ime'
  | 'window.lifecycle'
  | 'window.renderer'
  | 'update.service'

/** 单条日志并入 JSONL 顶层的结构化字段 */
export type DiagnosticMeta = Record<string, unknown>
