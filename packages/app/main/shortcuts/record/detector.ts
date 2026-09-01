import type {
  ActiveKeyboardShortcutEntry,
  KeyboardCode,
  ShortcutModifier,
  ShortcutRecordEvent,
} from '@shared/shortcuts'
import type { UiohookKeyboardEvent } from 'uiohook-napi'
import {
  normalizeKeyboardCode,
  pressKeyboardShortcutChord,
  releaseActiveKeyboardChords,
} from '@shared/shortcuts'
import { UiohookKey } from 'uiohook-napi'
import { acquireHook, addUiohookKeyboardListeners, releaseHook } from '../uiohook-lifecycle'

const IGNORED_KEY_CODES: ReadonlySet<number> = new Set([
  UiohookKey.CapsLock,
  UiohookKey.NumLock,
  UiohookKey.ScrollLock,
])

const CODE_TO_NAME: Map<number, string> = new Map(
  Object.entries(UiohookKey)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    .map(([name, code]) => [code, name]),
)

/** uiohook 将左侧修饰键命名为通用键名，这里补回物理侧别供新录制持久化 */
const SIDE_MODIFIER_CODE_TO_NAME: ReadonlyMap<number, KeyboardCode> = new Map([
  [UiohookKey.Meta, 'MetaLeft'],
  [UiohookKey.MetaRight, 'MetaRight'],
  [UiohookKey.Ctrl, 'ControlLeft'],
  [UiohookKey.CtrlRight, 'ControlRight'],
  [UiohookKey.Alt, 'AltLeft'],
  [UiohookKey.AltRight, 'AltRight'],
  [UiohookKey.Shift, 'ShiftLeft'],
  [UiohookKey.ShiftRight, 'ShiftRight'],
])

/** 非 null 表示当前已有一个录制会话，避免重复绑定全局监听 */
let activeEmit: ((event: ShortcutRecordEvent) => void) | null = null

/** 当前录制会话的 Worker 事件订阅清理函数 */
let removeHookListeners: (() => void) | null = null

/** 当前 detector 是否已经占用 uIOhook lifecycle 引用计数 */
let hookAcquired = false

/** keycode → 物理键与 keydown 时冻结的 chord */
const activeEntries = new Map<number, ActiveKeyboardShortcutEntry>()

/**
 * 录制期间监听真实键盘 down/up。
 * 该事件流只表达“捕获到了什么”，具体判定 press / doublePress / hold 由渲染层按 action 能力完成
 */
export function startRecordShortcutDetection(emit: (event: ShortcutRecordEvent) => void): void {
  if (activeEmit)
    return

  activeEmit = emit
  removeHookListeners = addUiohookKeyboardListeners({
    keydown: handleKeyDown,
    keyup: handleKeyUp,
  })

  try {
    if (!hookAcquired) {
      acquireHook()
      hookAcquired = true
    }
  }
  catch {
    /** renderer 的 DOM 录制仍可继续；这里只撤下不可用的全局 hook */
    stopRecordShortcutDetection()
  }
}

/**
 * 录制结束，移除监听器并释放 uIOhook
 */
export function stopRecordShortcutDetection(): void {
  removeHookListeners?.()
  removeHookListeners = null

  activeEmit = null
  activeEntries.clear()

  if (hookAcquired) {
    releaseHook()
    hookAcquired = false
  }
}

function handleKeyDown(event: UiohookKeyboardEvent): void {
  if (!activeEmit)
    return
  if (IGNORED_KEY_CODES.has(event.keycode))
    return
  if (activeEntries.has(event.keycode))
    return

  const key = normalizeKeyboardCode(keycodeToName(event.keycode))
  if (!key)
    return

  const chord = pressKeyboardShortcutChord(
    activeEntries,
    event.keycode,
    key,
    getModifiers(event),
  )
  activeEmit({
    phase: 'down',
    chord,
    timestamp: Date.now(),
  })
}

function handleKeyUp(event: UiohookKeyboardEvent): void {
  if (!activeEmit)
    return

  const timestamp = Date.now()
  for (const chord of releaseActiveKeyboardChords(
    activeEntries,
    event.keycode,
    getModifiers(event),
  )) {
    activeEmit({
      phase: 'up',
      chord,
      timestamp,
    })
  }
}

function keycodeToName(keycode: number): string | null {
  return SIDE_MODIFIER_CODE_TO_NAME.get(keycode)
    ?? CODE_TO_NAME.get(keycode)
    ?? null
}

function getModifiers(
  event: UiohookKeyboardEvent,
): ShortcutModifier[] {
  const modifiers: ShortcutModifier[] = []
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
