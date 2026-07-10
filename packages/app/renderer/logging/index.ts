import type { LogLevel, LogRecordPayload } from '@jl-org/log'
import { forwardToMain } from '@jl-org/log'
import { isElectron } from '@/utils/env'

const MAX_DETAIL_LENGTH = 4000

let initialized = false

/** 捕获 renderer 全局异常并转发到主进程 session 日志 */
export function initRendererDiagnostics(): void {
  if (initialized || !isElectron())
    return
  initialized = true

  window.addEventListener('error', (event) => {
    sendRendererLog(
      'error',
      'renderer.global',
      'window.error',
      event.message || 'renderer uncaught error',
      {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
      normalizeDetail(event.error),
    )
  })

  window.addEventListener('unhandledrejection', (event) => {
    sendRendererLog(
      'error',
      'renderer.global',
      'window.unhandledrejection',
      'renderer unhandled promise rejection',
      undefined,
      normalizeDetail(event.reason),
    )
  })
}

/** 创建带稳定 module/event 字段的 renderer 功能日志入口 */
export function createRendererFeatureLogger(module: RendererLogModule) {
  return {
    action: (action: string, meta?: DiagnosticMeta) => {
      sendRendererLog('info', module, `ui.${action}`, 'user action', {
        kind: 'user-action',
        action,
        ...meta,
      })
    },
    info: (event: string, message: string, meta?: DiagnosticMeta) => {
      sendRendererLog('info', module, event, message, meta)
    },
    warn: (event: string, message: string, meta?: DiagnosticMeta) => {
      sendRendererLog('warn', module, event, message, meta)
    },
    error: (event: string, message: string, error?: unknown, meta?: DiagnosticMeta) => {
      sendRendererLog('error', module, event, message, meta, normalizeDetail(error))
    },
    debug: (event: string, message: string, meta?: DiagnosticMeta) => {
      sendRendererLog('debug', module, event, message, meta)
    },
  }
}

export function sendRendererLog(
  level: LogLevel,
  module: RendererLogModule,
  event: string,
  message: string,
  meta?: DiagnosticMeta,
  detail?: unknown,
): void {
  if (!isElectron())
    return

  if (level === 'debug' && !isRendererDiagnosticDebugEnabled())
    return

  const record: LogRecordPayload = {
    level,
    message: `[${module}] ${message}`,
    time: new Date().toISOString(),
    meta: {
      module,
      event,
      process: 'renderer',
      window: getRendererWindowType(),
      route: window.location.hash || window.location.pathname,
      ...meta,
    },
  }

  if (detail !== undefined)
    record.detail = detail

  forwardToMain(record)
}

function isRendererDiagnosticDebugEnabled(): boolean {
  const globalDebug = (globalThis as { __ELECTRON_APP_LOG_DEBUG__?: unknown }).__ELECTRON_APP_LOG_DEBUG__
  return globalDebug === true
    || import.meta.env.VITE_ELECTRON_APP_LOG_DEBUG === '1'
    || import.meta.env.VITE_ELECTRON_APP_LOG_DEBUG === 'true'
}

function getRendererWindowType(): string {
  return new URLSearchParams(window.location.search).get('windowType') ?? 'main'
}

function normalizeDetail(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: truncate(value.stack ?? ''),
    }
  }

  return typeof value === 'string'
    ? truncate(value)
    : value
}

function truncate(value: string): string {
  return value.length <= MAX_DETAIL_LENGTH
    ? value
    : `${value.slice(0, MAX_DETAIL_LENGTH)}...`
}

/** renderer 日志模块名 */
export type RendererLogModule
  = | 'renderer.global'
    | 'auth'
    | 'http.client'
    | 'recording.page'
    | 'settings'
    | 'updater'
    | 'voice-ime'
    | 'menubar'
    | 'meeting-toast'
    | 'window.renderer'

/** 单条日志并入 JSONL 顶层的结构化字段 */
export type DiagnosticMeta = Record<string, unknown>
