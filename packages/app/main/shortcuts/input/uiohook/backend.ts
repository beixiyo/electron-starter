/** uIOhook 键盘捕获后端：Worker 生命周期、授权门禁与键码归一 */

import type { FnModifier, KeyboardInputPhase } from '@shared/shortcuts'
import type { Worker } from 'node:worker_threads'
import type { UiohookKeyboardEvent } from 'uiohook-napi'
import type { KeyboardInputBackend } from '../backend'
import type { UiohookWorkerMessage } from './worker'
import { createMainDiagnosticLogger } from '../../../logging'
import { getAppAccessibilityStatus } from '../../../permissions'
import { requestShortcutRuntimeSync } from '../../runtime-sync'
import { createKeyboardInputListeners } from '../backend'
import { toKeyboardCode } from './keycodes'
import createUiohookWorker from './worker?nodeWorker'

const UIOHOOK_START_TIMEOUT_MS = 1500
const log = createMainDiagnosticLogger('shortcut.runtime')

let refCount = 0
let health: UiohookBackendHealth = 'unknown'
let worker: Worker | null = null
let startupTimer: ReturnType<typeof setTimeout> | null = null
/** 已按下的 uIOhook 键码，用于过滤系统自动重复的 keydown */
const pressedKeycodes = new Set<number>()
const listeners = createKeyboardInputListeners()

export const uiohookKeyboardInputBackend: KeyboardInputBackend = {
  id: 'uiohook',
  isAvailable,
  acquire,
  release,
  sync,
  subscribe: listeners.add,
  /** Worker 已 `unref()` 且随进程退出；native stop 会 abort 整个进程，退出时什么都不做 */
  shutdown() {},
}

function isAvailable(): boolean {
  return health !== 'unavailable' && isPermissionGranted() && !isWaylandSession()
}

/**
 * macOS 未授予辅助功能时能否驱动 libuiohook
 *
 * 实测症状：未授权时启动 hook 会让**整个 Electron 进程 abort**，崩溃报告落在
 * `uiohook` 线程上，栈是 `uiohook_worker_start → uv_mutex_destroy → abort`
 * 根因是 addon 在 native 层直接 `abort()`，既不抛异常也不返回错误码——worker 里的
 * `try / catch`、worker 的 `error` / `exit` 事件、启动超时统统兜不住，进程当场没
 *
 * 所以这道判断必须前置到「根本不启动」，而不是启动后再收拾。放在这一层而不是各调用方，
 * 是因为崩溃是 libuiohook 的性质，不是某个功能的性质：任何一个直接 `acquire()`
 * 的消费方漏判都会把整个 App 带走
 *
 * 每次现查而不缓存：用户可能在运行期间去系统设置里授权，缓存会让本次启动之后一直不可用
 */
function isPermissionGranted(): boolean {
  /** 非 macOS 由 `getAppAccessibilityStatus` 自己返回 granted，这里不必再判平台 */
  return getAppAccessibilityStatus() === 'granted'
}

/** libuiohook 无法可靠监听原生 Wayland 会话，直接交给聚焦窗口的 DOM 兜底方案 */
function isWaylandSession(): boolean {
  return process.platform === 'linux'
    && process.env.XDG_SESSION_TYPE?.toLowerCase() === 'wayland'
}

function acquire(): void {
  if (!isPermissionGranted())
    throw new Error('uiohook requires macOS accessibility permission')

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

/**
 * Worker 首次成功启动后驻留到 App 进程结束，只把活跃消费者计数归还，不在这里调用
 * `uIOhook.stop()`。实测连续两轮长按会话的日志停在第二轮 stop 已发出、Worker exit
 * 尚未确认的窗口；而 native abort 会跨 Worker 终止整个 Electron 进程，线程级
 * try/catch 无法兜底。Worker 已经 `unref()`，不会阻止 App 正常退出
 */
function release(): void {
  if (refCount <= 0)
    return
  refCount--
}

/** 只补启动：有消费者、当前可用而 Worker 未在跑时拉起；停止永远不做，理由见 {@link release} */
function sync(): void {
  if (refCount <= 0 || worker || !isAvailable())
    return

  try {
    startWorker()
  }
  catch (error) {
    log.error('uiohook.sync-start-failed', 'uiohook worker failed to start during sync', error)
    markUnavailable()
  }
}

function startWorker(): void {
  const current = createUiohookWorker({ name: 'uiohook' })
  worker = current
  current.unref()
  pressedKeycodes.clear()

  current.on('message', (message: UiohookWorkerMessage) => {
    if (worker !== current)
      return

    switch (message.type) {
      case 'ready':
        clearStartupTimer()
        health = 'healthy'
        log.info('uiohook.worker-ready', 'uiohook worker started')
        return
      case 'failed':
        handleWorkerFailure(current, new Error(message.error))
        return
      case 'keydown':
        emitKeyboardEvent('down', message.event)
        return
      case 'keyup':
        emitKeyboardEvent('up', message.event)
    }
  })
  current.once('error', error => handleWorkerFailure(current, error))
  current.once('exit', (exitCode) => {
    if (worker !== current)
      return

    worker = null
    clearStartupTimer()
    log.warn('uiohook.worker-exited', 'uiohook worker exited unexpectedly', {
      activeRefCount: refCount,
      exitCode,
    })
    listeners.emit({ phase: 'reset', timestamp: Date.now() })
    markUnavailable()
  })

  startupTimer = setTimeout(() => {
    handleWorkerFailure(current, new Error(`uiohook worker start timed out after ${UIOHOOK_START_TIMEOUT_MS}ms`))
  }, UIOHOOK_START_TIMEOUT_MS)
  startupTimer.unref?.()
}

/** 键码归一到规范键名，并过滤系统自动重复的 keydown；未知键直接丢弃 */
function emitKeyboardEvent(phase: KeyboardInputPhase, event: UiohookKeyboardEvent): void {
  if (phase === 'down') {
    if (pressedKeycodes.has(event.keycode))
      return
    pressedKeycodes.add(event.keycode)
  }
  else {
    pressedKeycodes.delete(event.keycode)
  }

  const key = toKeyboardCode(event.keycode)
  if (!key)
    return

  listeners.emit({
    phase,
    key,
    modifiers: getModifiers(event),
    fn: false,
    timestamp: Date.now(),
  })
}

function getModifiers(event: UiohookKeyboardEvent): FnModifier[] {
  const modifiers: FnModifier[] = []
  if (event.metaKey)
    modifiers.push('Meta')
  if (event.ctrlKey)
    modifiers.push('Control')
  if (event.altKey)
    modifiers.push('Alt')
  if (event.shiftKey)
    modifiers.push('Shift')

  return modifiers
}

function handleWorkerFailure(current: Worker, error: Error): void {
  if (worker !== current)
    return

  log.error('uiohook.worker-failed', 'uiohook worker failed', error)
  worker = null
  clearStartupTimer()
  void current.terminate().catch(() => {})
  markUnavailable()
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
   * 合并到当前同步完成后再执行，避免同步重入导致无限 reset/apply
   */
  requestShortcutRuntimeSync()
}

/**
 * uIOhook 的运行状态只反映「最近一次启动是否成功」
 *
 * `unknown` 不能视为失败：首次注册前不能为了探测而永久占用 native hook，
 * 且部分平台只有真正 start 后才能报告底层错误。启动失败后记为
 * `unavailable`，让运行时解析器把全局键盘绑定交给渲染进程
 */
type UiohookBackendHealth = 'unknown' | 'healthy' | 'unavailable'
