/** 全局 Escape 仲裁器：被动监听裸 Escape，一次按下只交给一个消费者 */

import type { KeyboardInput } from '@shared/shortcuts'
import { BrowserWindow } from 'electron'
import { createMainDiagnosticLogger } from './logging'
import { keyboardInputBackend } from './shortcuts/input'
import { onShortcutRuntimeSyncRequested } from './shortcuts/runtime-sync'

const log = createMainDiagnosticLogger('shortcut.runtime')

/** 消费者优先级；数值越大越先获得一次 Escape */
export const GLOBAL_ESCAPE_PRIORITY = {
  session: 100,
  surface: 50,
  toast: 10,
} as const

const consumers = new Set<GlobalEscapeConsumer>()
let unsubscribe: (() => void) | null = null
let unsubscribeRuntimeSync: (() => void) | null = null
let backendAcquired = false
/** 最近一次 Escape 按下后尚未收到抬起；重复 keydown 不会再次分发 */
let escapeHeld = false

/**
 * 登记一个 Escape 消费者；第一个消费者到场时接上键盘后端，最后一个离场时释放
 *
 * 后端是被动监听，不会阻止前台应用继续接收按键。后端不可用时保持安静降级，
 * 调用方仍可保留自己的鼠标或 DOM 关闭路径
 *
 * @returns 幂等注销函数
 */
export function registerGlobalEscapeConsumer(consumer: GlobalEscapeConsumer): () => void {
  consumers.add(consumer)
  if (consumers.size === 1) attach()

  return () => {
    if (!consumers.delete(consumer)) return
    if (consumers.size === 0) detach()
  }
}

/** 只接受一轮完整按下和抬起中的第一次裸 Escape */
function handleInput(input: KeyboardInput): void {
  if (input.phase === 'reset') {
    escapeHeld = false
    return
  }

  if (input.key !== 'Escape') return

  if (input.phase === 'up') {
    escapeHeld = false
    return
  }

  if (escapeHeld) return
  escapeHeld = true

  /** 带修饰键或 Fn 的组合保留给系统和前台应用 */
  if (input.modifiers.length > 0 || input.fn) return

  dispatch()
}

/** 把一次裸 Escape 交给优先级最高、当前在场的消费者 */
function dispatch(): void {
  const appFocused = BrowserWindow.getFocusedWindow() !== null
  const ordered = [...consumers].sort((a, b) => b.priority - a.priority)

  for (const consumer of ordered) {
    if (consumer.yieldToFocusedWindow && appFocused) continue
    if (consumer.isActive && !consumer.isActive()) continue

    log.info('escape.dispatched', 'global escape dispatched', {
      consumer: consumer.id,
      appFocused,
    })
    consumer.onEscape()
    return
  }
}

function attach(): void {
  escapeHeld = false
  unsubscribe = keyboardInputBackend.subscribe(handleInput)
  unsubscribeRuntimeSync = onShortcutRuntimeSyncRequested(syncGlobalEscape)

  syncGlobalEscape()
}

/** 按当前权限重试后端启动；无消费者或已启动时不做任何操作 */
export function syncGlobalEscape(): void {
  if (consumers.size === 0 || backendAcquired) return
  if (!keyboardInputBackend.isAvailable()) return

  try {
    keyboardInputBackend.acquire()
    backendAcquired = true
    log.info('escape.watcher-started', 'global escape watcher started', {
      backend: keyboardInputBackend.id,
    })
  }
  catch (error) {
    log.error('escape.watcher-start-failed', 'global escape watcher failed to start', error)
  }
}

function detach(): void {
  unsubscribe?.()
  unsubscribe = null
  unsubscribeRuntimeSync?.()
  unsubscribeRuntimeSync = null
  escapeHeld = false

  if (!backendAcquired) return

  keyboardInputBackend.release()
  backendAcquired = false
  log.info('escape.watcher-stopped', 'global escape watcher stopped', {
    backend: keyboardInputBackend.id,
  })
}

/** 一个响应全局 Escape 的消费者 */
export type GlobalEscapeConsumer = {
  /** 只用于诊断日志 */
  id: string
  /** 数值越大越先处理；同级按登记顺序不作为公共契约 */
  priority: number
  /** 自有窗口有焦点时是否让位给该窗口的 DOM 键盘层 @default false */
  yieldToFocusedWindow?: boolean
  /** 消费者仍在场时返回 true；返回 false 会继续寻找下一位 */
  isActive?: () => boolean
  /** 处理这一次裸 Escape */
  onEscape: () => void
}
