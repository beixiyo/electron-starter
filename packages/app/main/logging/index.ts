import type { LogLevel } from '@jl-org/log'
import type { IpcMain } from 'electron'
import { join } from 'node:path'
import { listenElectronLogs, NodeLogger } from '@jl-org/log/node'
import { getAppStorageAreaPath } from '@main/storage'
import { app } from 'electron'

let logger: NodeLogger | null = null
let sessionId: string | null = null
let stopRendererLogListener: (() => void) | null = null
let initialized = false

/** 初始化主进程与 renderer 共用的 session 级诊断日志 */
export function initAppLogging(ipcMain: IpcMain): void {
  if (initialized)
    return
  initialized = true

  stopRendererLogListener = listenElectronLogs(ipcMain, getAppLogger())

  app.once('will-quit', () => {
    stopRendererLogListener?.()
    void closeAppLogger()
  })

  createMainDiagnosticLogger('app.lifecycle').info(
    'logging.ready',
    'diagnostic log initialized',
    {
      logDir: getDiagnosticLogDir(),
      debug: isDiagnosticDebugEnabled(),
    },
  )
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
  if (logger)
    return logger

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
      getAppLogger().error(message, error, config)
      return
    case 'debug':
      getAppLogger().debug(message, config)
      return
    case 'log':
      getAppLogger().log(message)
  }
}

function getSessionId(): string {
  if (sessionId)
    return sessionId

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
export type MainDiagnosticModule
  = | 'app.lifecycle'
    | 'app.power'
    | 'ipc.service'
    | 'meeting.detection'
    | 'native.bridge'
    | 'native.recorder'
    | 'native.recording'
    | 'permission'
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
