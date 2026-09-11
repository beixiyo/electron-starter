/** 系统级输入 runtime backend：把 Fn 绑定与全局 keyboard 绑定接到平台键盘捕获后端 */

import type { ShortcutBinding, ShortcutGestureRuntimeEntry, ShortcutRuntimeEvent } from '@shared/shortcuts'
import type { ShortcutRuntimeBackend, ShortcutRuntimeBackendContext, ShortcutRuntimeEntry } from './runtime-backend'
import { createShortcutInputRuntime } from '@shared/shortcuts'
import { createMainDiagnosticLogger } from '../logging'
import { setFnComboSuppression } from './fn-combo-suppression'
import { keyboardInputBackend } from './input'
import { getShortcutRuntimeEntries } from './runtime-backend'
import { addShortcutRuntimeSuspensionListener, isShortcutRuntimeSuspended } from './suspension'

const log = createMainDiagnosticLogger('shortcut.runtime')

let registeredEntries = new Map<string, ShortcutRuntimeEntry>()
let runtimeContext: ShortcutRuntimeBackendContext | null = null
let unsubscribe: (() => void) | null = null
let backendAcquired = false

const runtime = createShortcutInputRuntime<ShortcutBinding>({
  entries: [],
  isPaused: isShortcutRuntimeSuspended,
  emit: emitRuntimeEvent,
})

/** backend 与应用同生命周期；暂停只清输入与手势状态，不改捕获后端的引用计数 */
addShortcutRuntimeSuspensionListener(() => runtime.cancel())

/**
 * 认领两类绑定：所有 Fn 绑定（DOM 拿不到 Fn/Globe，即便 local 也只能在这里捕获，
 * 生效范围靠 `canTrigger` 的聚焦门禁约束），以及有效 scope 为 global 的 keyboard 绑定；
 * 降级到 local 的 keyboard 绑定由渲染进程 DOM backend 接管
 */
export const systemInputShortcutRuntimeBackend: ShortcutRuntimeBackend = {
  id: 'system-input',
  reset,
  sync: () => keyboardInputBackend.sync(),
  apply(bindings, context) {
    reset()
    runtimeContext = context

    const entries = getShortcutRuntimeEntries(bindings, context, isSystemInputBinding)
    if (entries.length === 0)
      return

    registeredEntries = new Map(entries.map(entry => [entry.id, entry]))
    runtime.updateEntries(entries.map(toGestureEntry))
    /** Fn 组合的物理键不会被 helper 拦下，本 App 窗口里要自己吞掉，否则字符落进输入框 */
    setFnComboSuppression(entries, context.canTrigger)
    unsubscribe = keyboardInputBackend.subscribe(runtime.handle)

    try {
      keyboardInputBackend.acquire()
      backendAcquired = true
    }
    catch (error) {
      /** 能力解析与真正启动之间权限可能被收回；捕获后端已把自己标成不可用并请求重算 */
      log.warn('system-input.acquire-failed', 'keyboard input backend unavailable, system shortcuts skipped', {
        error: error instanceof Error
          ? error.message
          : String(error),
      })
      reset()
    }
  },
}

function reset(): void {
  runtime.updateEntries([])
  setFnComboSuppression([], () => false)
  unsubscribe?.()
  unsubscribe = null
  registeredEntries = new Map()
  runtimeContext = null

  if (backendAcquired) {
    keyboardInputBackend.release()
    backendAcquired = false
  }
}

function emitRuntimeEvent(event: ShortcutRuntimeEvent): void {
  const entry = registeredEntries.get(event.id)
  const context = runtimeContext
  if (!entry || !context)
    return
  /** release 永远放行：hold 已经开始，即便权限或焦点变化也必须把它结束掉 */
  if (event.phase === 'trigger' && !context.canTrigger(entry.binding))
    return

  context.emit({ ...entry, phase: event.phase, gesture: event.gesture })
}

function toGestureEntry(entry: ShortcutRuntimeEntry): ShortcutGestureRuntimeEntry<ShortcutBinding> {
  return {
    id: entry.id,
    binding: entry.binding,
    canStart: () => runtimeContext?.canTrigger(entry.binding) ?? false,
  }
}

function isSystemInputBinding(binding: ShortcutBinding | null): binding is ShortcutBinding {
  return !!binding && (binding.chord.source === 'fn' || binding.scope === 'global')
}
