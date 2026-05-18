/**
 * 统一异常处理工具
 * 提供统一的错误处理和日志记录功能
 */

/**
 * 错误上下文信息
 */
export interface ErrorContext {
  /** 模块名称 */
  module?: string
  /** 操作名称 */
  operation?: string
  /** 额外上下文信息 */
  context?: Record<string, unknown>
}

/**
 * 处理异常并记录详细日志
 * @param error 错误对象
 * @param context 错误上下文
 * @returns 处理后的错误信息（用于返回给调用者）
 */
export function handleError(error: unknown, context?: ErrorContext): string {
  const errorMessage = error instanceof Error
    ? error.message
    : String(error)
  const errorStack = error instanceof Error
    ? error.stack
    : undefined

  /** 构建日志信息 */
  const logParts: string[] = []
  if (context?.module) {
    logParts.push(`[${context.module}]`)
  }
  if (context?.operation) {
    logParts.push(`${context.operation}:`)
  }
  logParts.push(errorMessage)

  const logMessage = logParts.join(' ')

  /** 记录错误日志 */
  console.error(logMessage)
  if (errorStack) {
    console.error('错误堆栈:', errorStack)
  }
  if (context?.context && Object.keys(context.context).length > 0) {
    console.error('上下文信息:', context.context)
  }

  /** 返回简化的错误信息（用于返回给调用者） */
  return errorMessage
}

/**
 * 安全执行函数，捕获并处理异常
 * @param fn 要执行的函数
 * @param fallback 异常时的回退值
 * @param context 错误上下文
 * @returns 函数执行结果或回退值
 */
export function safeExecute<T>(
  fn: () => T,
  fallback: T,
  context?: ErrorContext,
): T {
  try {
    return fn()
  }
  catch (error) {
    handleError(error, context)
    return fallback
  }
}

/**
 * 安全执行异步函数，捕获并处理异常
 * @param fn 要执行的异步函数
 * @param fallback 异常时的回退值
 * @param context 错误上下文
 * @returns 函数执行结果或回退值
 */
export async function safeExecuteAsync<T>(
  fn: () => Promise<T>,
  fallback: T,
  context?: ErrorContext,
): Promise<T> {
  try {
    return await fn()
  }
  catch (error) {
    handleError(error, context)
    return fallback
  }
}
