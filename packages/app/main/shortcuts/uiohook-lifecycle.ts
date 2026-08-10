import type { EventEmitter } from 'node:events'
import { uIOhook } from 'uiohook-napi'
import { requestShortcutRuntimeSync } from './runtime-sync'

let refCount = 0
let running = false
let health: UiohookBackendHealth = 'unknown'
let errorListenerBound = false

/**
 * uIOhook 的运行状态只反映「最近一次启动是否成功」。
 *
 * `unknown` 不能视为失败：首次注册前不能为了探测而永久占用 native hook，
 * 且部分平台只有真正 start 后才能报告底层错误。启动失败后记为
 * `unavailable`，让运行时解析器把全局键盘绑定交给渲染进程。
 */
type UiohookBackendHealth = 'unknown' | 'healthy' | 'unavailable'

/** 当前运行时是否可以尝试使用 uIOhook */
export function canUseUiohookBackend(): boolean {
  return health !== 'unavailable'
}

/**
 * 重新探测已经失败的 uIOhook 捕获后端。
 *
 * 权限变化或原生捕获后端恢复后，主进程会再次同步运行时。此处只在
 * 没有活跃引用时做一次轻量 start/stop 探测，避免把失败状态永久缓存；
 * 已经在运行时不做额外 stop/start，防止重注册过程中丢事件。
 */
export function refreshUiohookBackendHealth(): UiohookBackendHealth {
  ensureErrorListener()

  if (running || health !== 'unavailable')
    return health

  try {
    const shouldKeepRunning = refCount > 0
    uIOhook.start()
    running = true
    health = 'healthy'
    if (!shouldKeepRunning) {
      uIOhook.stop()
      running = false
    }
  }
  catch {
    running = false
    markUnavailable()
  }

  return health
}

/** 声明需要 uIOhook，若尚未启动则启动 */
export function acquireHook(): void {
  ensureErrorListener()
  refCount++
  if (running)
    return

  try {
    uIOhook.start()
    running = true
    health = 'healthy'
  }
  catch (error) {
    refCount--
    markUnavailable()
    throw error
  }
}

/** 释放对 uIOhook 的需求，所有使用方释放后自动停止 */
export function releaseHook(): void {
  if (refCount <= 0)
    return
  refCount--
  if (refCount > 0 || !running)
    return

  try {
    uIOhook.stop()
  }
  catch {
    markUnavailable()
  }
  finally {
    running = false
  }
}

function ensureErrorListener(): void {
  if (errorListenerBound)
    return

  /** uiohook-napi 没有在类型声明中暴露 error 事件，但底层 EventEmitter 会转发它 */
  const hookEmitter = uIOhook as unknown as EventEmitter
  hookEmitter.on('error', handleUiohookError)
  errorListenerBound = true
}

function handleUiohookError(): void {
  running = false
  markUnavailable()
}

function markUnavailable(): void {
  const changed = health !== 'unavailable'
  health = 'unavailable'

  if (!changed)
    return

  /**
   * 启动失败可能发生在 reapplyShortcutRuntime 内部；runtime-sync 会把请求
   * 合并到当前同步完成后再执行，避免同步重入导致无限 reset/apply。
   */
  requestShortcutRuntimeSync()
}
