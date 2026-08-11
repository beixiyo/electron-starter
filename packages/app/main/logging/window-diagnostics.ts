import type { WindowType } from '@shared'
import type { BrowserWindow } from 'electron'
import { createMainDiagnosticLogger } from './index'

const CONSOLE_MESSAGE_DEDUPE_MS = 5000
const MAX_RECENT_CONSOLE_MESSAGES = 500
const MAX_MESSAGE_LENGTH = 2000

const log = createMainDiagnosticLogger('window.renderer')
const recentConsoleMessages = new Map<string, number>()

/** 记录 renderer 卡死、崩溃、加载失败与高等级 console 消息 */
export function attachWindowDiagnostics(window: BrowserWindow, type?: WindowType): void {
  const windowLabel = type ?? 'unknown'

  window.on('unresponsive', () => {
    log.warn('window.unresponsive', 'renderer window became unresponsive', getWindowMeta(window, windowLabel))
  })

  window.on('responsive', () => {
    log.info('window.responsive', 'renderer window became responsive again', getWindowMeta(window, windowLabel))
  })

  window.webContents.on('render-process-gone', (_event, details) => {
    const meta = {
      ...getWindowMeta(window, windowLabel),
      reason: details.reason,
      exitCode: details.exitCode,
    }

    if (details.reason === 'clean-exit') {
      log.info('renderer.gone.clean', 'renderer process exited cleanly', meta)
      return
    }

    log.error('renderer.gone', 'renderer process gone unexpectedly', undefined, meta)
  })

  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    log.error('renderer.preload-error', 'preload script threw an unhandled exception', error, {
      ...getWindowMeta(window, windowLabel),
      preloadPath,
    })
  })

  window.webContents.on('did-fail-load', (
    _event,
    errorCode,
    errorDescription,
    validatedURL,
    isMainFrame,
    frameProcessId,
    frameRoutingId,
  ) => {
    if (errorCode === -3)
      return

    log.warn('renderer.did-fail-load', 'renderer failed to load', {
      ...getWindowMeta(window, windowLabel),
      errorCode,
      errorDescription,
      validatedURL: sanitizeUrlForLog(validatedURL),
      isMainFrame,
      frameProcessId,
      frameRoutingId,
    })
  })

  window.webContents.on('console-message', (details) => {
    const { level, message, lineNumber, sourceId } = details

    if (level === 'info' || level === 'debug')
      return

    /** 去重 key 只取 message 长度 + 前 200 字符,避免超长堆栈把 Map 的 key 撑到数百 KB */
    const key = `${windowLabel}:${level}:${sourceId}:${lineNumber}:${message.length}:${message.slice(0, 200)}`
    const now = Date.now()
    const lastAt = recentConsoleMessages.get(key)
    if (lastAt && now - lastAt < CONSOLE_MESSAGE_DEDUPE_MS)
      return

    recentConsoleMessages.set(key, now)
    trimRecentConsoleMessages()

    const meta = {
      ...getWindowMeta(window, windowLabel),
      consoleLevel: level,
      line: lineNumber,
      sourceId: sanitizeUrlForLog(sourceId),
      messageLength: message.length,
    }

    if (level === 'error') {
      log.error('renderer.console-error', 'renderer console error emitted', undefined, meta)
      return
    }

    log.warn('renderer.console-warn', 'renderer console warning emitted', meta)
  })
}

function getWindowMeta(window: BrowserWindow, type: WindowType | 'unknown') {
  return {
    window: type,
    windowId: window.id,
    webContentsId: window.webContents.id,
    url: sanitizeUrlForLog(safeGetUrl(window)),
  }
}

function trimRecentConsoleMessages(): void {
  if (recentConsoleMessages.size <= MAX_RECENT_CONSOLE_MESSAGES)
    return

  const oldestKey = recentConsoleMessages.keys().next().value
  if (oldestKey)
    recentConsoleMessages.delete(oldestKey)
}

function safeGetUrl(window: BrowserWindow): string {
  return window.isDestroyed()
    ? ''
    : window.webContents.getURL()
}

function sanitizeUrlForLog(value: string): string {
  if (!value)
    return ''

  try {
    const url = new URL(value)
    return truncate(`${url.protocol}//${url.host}${url.pathname}`)
  }
  catch {
    return truncate(value
      .replace(/([?&]token=)[^&\s]+/gi, '$1[redacted]')
      .replace(/#.*/, '#[redacted]'))
  }
}

function truncate(value: string): string {
  return value.length <= MAX_MESSAGE_LENGTH
    ? value
    : `${value.slice(0, MAX_MESSAGE_LENGTH)}...`
}
