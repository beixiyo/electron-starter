import type {
  ActiveKeyboardShortcutEntry,
  KeyboardShortcutChord,
  ShortcutBinding,
  ShortcutBindings,
  ShortcutGestureRuntimeEntry,
  ShortcutRuntimeCapabilities,
  ShortcutRuntimeEvent,
} from '@shared/shortcuts'
import {
  createShortcutGestureEngine,
  getActiveKeyboardModifierCodes,
  getBrowserLogicalShortcutModifiers,
  keyboardShortcutChordMatchesModifierState,
  SHORTCUT_ACTIONS,
  toBrowserShortcutRecordEvents,
  toEffectiveShortcutBindings,
} from '@shared/shortcuts'
import { useEffect, useRef } from 'react'
import { isElectron } from '../utils/env'
import {
  getShortcutBindings,
  getShortcutRuntimeCapabilities,
  isShortcutRuntimePaused,
  subscribeShortcutBindings,
  triggerShortcutAction,
} from './shortcutConfigAdapter'

const ELECTRON_SHORTCUT_ACTION_IDS: ReadonlySet<string> = new Set(
  SHORTCUT_ACTIONS.map(action => action.id),
)

/**
 * 窗口内快捷键运行时，只使用浏览器按下和松开事件，天然跨平台。
 *
 * 认领两类绑定：声明为 `local` 的动作，以及声明 `global` 但当前系统级捕获不可用（例如
 * macOS 未授予辅助功能）而降级下来的动作。默认把触发交回主进程执行业务，
 * 传入 handlers 可覆盖（Web 端没有主进程业务时自行接管）
 *
 * @param handlers action id → 处理器；缺省转发给主进程
 */
export function useShortcutRuntime(handlers: ShortcutRuntimeHandlers = {}): void {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    let disposed = false
    let reloadVersion = 0
    let runtime: BrowserShortcutRuntime | null = null

    /** 先撤下旧监听器，再异步读取新配置，避免主进程切换后旧运行时继续吞键 */
    const disposeRuntime = () => {
      runtime?.dispose()
      runtime = null
    }

    const reload = async () => {
      const version = ++reloadVersion
      disposeRuntime()

      try {
        const [bindings, capabilities] = await Promise.all([
          getShortcutBindings(),
          getShortcutRuntimeCapabilities(),
        ])

        if (disposed || version !== reloadVersion)
          return

        runtime = createBrowserShortcutRuntime({
          bindings,
          capabilities,
          /** 无人消费的动作不注册：注册即 preventDefault，会静默吞掉用户按键 */
          canHandle: id => !!handlersRef.current[id]
            || (isElectron() && ELECTRON_SHORTCUT_ACTION_IDS.has(id)),
          emit: (event) => {
            const handler = handlersRef.current[event.id]
            if (handler) {
              handler(event)
              return
            }

            void triggerShortcutAction(event)
          },
        })
      }
      catch {
        /** 主进程暂时不可用时保持运行时撤下，后续收到运行时变更通知后重新尝试 */
      }
    }

    void reload()
    const unsubscribe = subscribeShortcutBindings(() => {
      void reload()
    })

    return () => {
      disposed = true
      unsubscribe()
      disposeRuntime()
    }
  }, [])
}

/** 创建窗口内 keyboard runtime，并返回成对的监听清理入口 */
export function createBrowserShortcutRuntime(
  options: CreateBrowserShortcutRuntimeOptions,
): BrowserShortcutRuntime {
  const { bindings, capabilities, canHandle, emit } = options
  const shortcuts = createBrowserShortcutEntries(bindings, capabilities, canHandle)
  const activeEntries = new Map<string, ActiveKeyboardShortcutEntry>()
  const engine = createShortcutGestureEngine({
    entries: shortcuts,
    isPaused: isShortcutRuntimePaused,
    emit,
  })

  const handleKeyDown = (event: KeyboardEvent) => {
    if (isShortcutRuntimePaused()) {
      cancelState()
      return
    }

    const recordEvents = toBrowserShortcutRecordEvents(event, 'down', activeEntries)
    if (recordEvents.length === 0)
      return

    reconcileModifierState(event)
    let handled = false
    for (const recordEvent of recordEvents)
      handled = engine.handle(recordEvent) || handled

    if (handled) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  const handleKeyUp = (event: KeyboardEvent) => {
    if (isShortcutRuntimePaused()) {
      cancelState()
      return
    }

    const recordEvents = toBrowserShortcutRecordEvents(event, 'up', activeEntries)
    if (recordEvents.length === 0)
      return

    let handled = false
    for (const recordEvent of recordEvents)
      handled = engine.handle(recordEvent) || handled

    reconcileModifierState(event)
    if (handled) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  /** modifier 状态偏离绑定时立即取消候选，并释放已经触发的 hold */
  const reconcileModifierState = (event: KeyboardEvent) => {
    const activePhysicalModifiers = getActiveKeyboardModifierCodes(activeEntries.values())
    const logicalModifiers = getBrowserLogicalShortcutModifiers(event)

    for (const shortcut of shortcuts) {
      if (!keyboardShortcutChordMatchesModifierState(
        shortcut.binding.chord,
        activePhysicalModifiers,
        logicalModifiers,
      )) {
        engine.cancelChord(shortcut.binding.chord)
      }
    }
  }

  const cancelState = () => {
    engine.cancelActiveGestures()
    activeEntries.clear()
  }

  const handleBlur = () => {
    cancelState()
  }

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'hidden')
      cancelState()
  }

  window.addEventListener('keydown', handleKeyDown, true)
  window.addEventListener('keyup', handleKeyUp, true)
  window.addEventListener('blur', handleBlur)
  document.addEventListener('visibilitychange', handleVisibilityChange)

  return {
    dispose() {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
      window.removeEventListener('blur', handleBlur)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      activeEntries.clear()
      engine.dispose()
    },
  }
}

function createBrowserShortcutEntries(
  bindings: ShortcutBindings,
  capabilities: ShortcutRuntimeCapabilities,
  canHandle: (id: string) => boolean,
): BrowserShortcutEntry[] {
  /** 先解析出实际生效 scope，降级到窗口内的 global 动作也会在这里变成 local */
  const effectiveBindings = toEffectiveShortcutBindings(bindings, capabilities)

  return Object.entries(effectiveBindings).flatMap(([id, binding]) => {
    if (!isBrowserRuntimeBinding(binding) || !canHandle(id))
      return []

    return [{ id, binding }]
  })
}

/** DOM 只能捕获普通键盘事件；无法取得 Fn/Globe，即便降级也只能留在原生捕获后端 */
function isBrowserRuntimeBinding(
  binding: ShortcutBinding | null,
): binding is ShortcutBinding & { chord: KeyboardShortcutChord } {
  return !!binding
    && binding.scope === 'local'
    && binding.chord.source === 'keyboard'
}

type BrowserShortcutRuntime = {
  dispose: () => void
}

type CreateBrowserShortcutRuntimeOptions = {
  /** 持久化绑定，scope 仍是动作声明值 */
  bindings: ShortcutBindings
  /** 当前运行时能力，用于解析降级后的实际 scope */
  capabilities: ShortcutRuntimeCapabilities
  /** 该 action 是否有人消费；返回 false 时不注册，避免 preventDefault 吞键 */
  canHandle: (id: string) => boolean
  emit: (event: ShortcutRuntimeEvent) => void
}

type BrowserShortcutEntry = ShortcutGestureRuntimeEntry<ShortcutBinding & { chord: KeyboardShortcutChord }>

/** 动作标识到运行时事件处理器的映射 */
export type ShortcutRuntimeHandlers = Partial<Record<string, (event: ShortcutRuntimeEvent) => void>>
