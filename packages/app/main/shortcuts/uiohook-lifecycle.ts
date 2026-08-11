import type { Worker } from 'node:worker_threads'
import type { UiohookKeyboardEvent } from 'uiohook-napi'
import { EventEmitter as NodeEventEmitter } from 'node:events'
import { createMainDiagnosticLogger } from '../logging'
import { requestShortcutRuntimeSync } from './runtime-sync'
import createUiohookWorker from './uiohook-worker?nodeWorker'

let refCount = 0
let running = false
let health: UiohookBackendHealth = 'unknown'
let worker: Worker | null = null
let stopping = false
let startupTimer: ReturnType<typeof setTimeout> | null = null
const hookEvents = new NodeEventEmitter()
const log = createMainDiagnosticLogger('shortcut.runtime')

const UIOHOOK_START_TIMEOUT_MS = 1500

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
 * 返回最近一次 uIOhook Worker 启动结果
 *
 * 权限门禁在 provider 层处理；native addon 一旦在当前进程内启动失败，保持
 * unavailable 并降级到 renderer DOM，避免自动重试不断遗留卡死的 native 线程
 */
export function refreshUiohookBackendHealth(): UiohookBackendHealth {
  return health
}

/** 声明需要 uIOhook，若尚未启动则启动 */
export function acquireHook(): void {
  refCount++
  if (worker)
    return

  try {
    startWorker()
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

  stopWorker()
}

/** 订阅 Worker 转发的原始键盘事件 */
export function addUiohookKeyboardListeners(listeners: UiohookKeyboardListeners): () => void {
  hookEvents.on('keydown', listeners.keydown)
  hookEvents.on('keyup', listeners.keyup)

  return () => {
    hookEvents.off('keydown', listeners.keydown)
    hookEvents.off('keyup', listeners.keyup)
  }
}

function startWorker(): void {
  const current = createUiohookWorker({ name: 'uiohook' })
  worker = current
  running = false
  current.unref()

  current.on('message', (message: UiohookWorkerMessage) => {
    if (worker !== current)
      return

    switch (message.type) {
      case 'ready':
        clearStartupTimer()
        running = true
        health = 'healthy'
        log.debug('uiohook.worker-ready', 'uiohook worker started')
        if (refCount === 0)
          stopWorker()
        return
      case 'failed':
        handleWorkerFailure(current, new Error(message.error))
        return
      case 'keydown':
      case 'keyup':
        hookEvents.emit(message.type, message.event)
    }
  })
  current.once('error', error => handleWorkerFailure(current, error))
  current.once('exit', () => {
    if (worker !== current)
      return

    const stoppedExpectedly = stopping
    const shouldRestart = stoppedExpectedly && refCount > 0 && health !== 'unavailable'
    const exitedUnexpectedly = !stoppedExpectedly && refCount > 0
    worker = null
    running = false
    stopping = false
    clearStartupTimer()
    if (stoppedExpectedly)
      log.debug('uiohook.worker-stopped', 'uiohook worker stopped')
    if (exitedUnexpectedly) {
      markUnavailable()
      return
    }
    if (shouldRestart)
      startWorker()
  })

  startupTimer = setTimeout(() => {
    handleWorkerFailure(current, new Error(`uiohook worker start timed out after ${UIOHOOK_START_TIMEOUT_MS}ms`))
  }, UIOHOOK_START_TIMEOUT_MS)
  startupTimer.unref?.()
}

function handleWorkerFailure(current: Worker, error: Error): void {
  if (worker !== current)
    return

  log.error('uiohook.worker-failed', 'uiohook worker failed', error)
  worker = null
  running = false
  stopping = false
  clearStartupTimer()
  void current.terminate().catch(() => {})
  markUnavailable()
}

function stopWorker(): void {
  if (!worker || stopping)
    return

  stopping = true
  running = false
  clearStartupTimer()
  worker.postMessage({ type: 'stop' } satisfies UiohookWorkerCommand)
}

function clearStartupTimer(): void {
  if (!startupTimer)
    return

  clearTimeout(startupTimer)
  startupTimer = null
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

type UiohookKeyboardListeners = {
  keydown: (event: UiohookKeyboardEvent) => void
  keyup: (event: UiohookKeyboardEvent) => void
}

type UiohookWorkerCommand = {
  type: 'stop'
}

type UiohookWorkerMessage
  = | { type: 'ready' }
    | { type: 'failed', error: string }
    | { type: 'keydown' | 'keyup', event: UiohookKeyboardEvent }
