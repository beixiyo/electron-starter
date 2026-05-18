/**
 * 统一日志工具
 * 提供统一的日志记录功能，便于后续扩展（如日志文件、远程日志等）
 */

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

/**
 * 日志上下文信息
 */
export interface LogContext {
  /** 模块名称 */
  module?: string
  /** 操作名称 */
  operation?: string
  /** 额外上下文信息 */
  context?: Record<string, unknown>
}

/**
 * 格式化日志消息
 */
function formatLogMessage(level: LogLevel, message: string, context?: LogContext): string {
  const parts: string[] = []
  parts.push(`[${level}]`)
  if (context?.module) {
    parts.push(`[${context.module}]`)
  }
  if (context?.operation) {
    parts.push(`${context.operation}:`)
  }
  parts.push(message)
  return parts.join(' ')
}

/**
 * 记录调试日志
 */
export function logDebug(message: string, context?: LogContext): void {
  if (process.env.NODE_ENV === 'development') {
    console.debug(formatLogMessage(LogLevel.DEBUG, message, context))
    if (context?.context) {
      console.debug('上下文:', context.context)
    }
  }
}

/**
 * 记录信息日志
 */
export function logInfo(message: string, context?: LogContext): void {
  console.log(formatLogMessage(LogLevel.INFO, message, context))
  if (context?.context) {
    console.log('上下文:', context.context)
  }
}

/**
 * 记录警告日志
 */
export function logWarn(message: string, context?: LogContext): void {
  console.warn(formatLogMessage(LogLevel.WARN, message, context))
  if (context?.context) {
    console.warn('上下文:', context.context)
  }
}

/**
 * 记录错误日志
 */
export function logError(message: string, error?: unknown, context?: LogContext): void {
  console.error(formatLogMessage(LogLevel.ERROR, message, context))
  if (error instanceof Error) {
    console.error('错误详情:', error.message)
    if (error.stack) {
      console.error('错误堆栈:', error.stack)
    }
  }
  else if (error !== undefined) {
    console.error('错误详情:', error)
  }
  if (context?.context) {
    console.error('上下文:', context.context)
  }
}
