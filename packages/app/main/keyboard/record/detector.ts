import type { KeyboardShortcutChord, ShortcutModifier, ShortcutRecordEvent } from '@ipc/services/shortcut-config/contract'
import type { UiohookKeyboardEvent } from 'uiohook-napi'
import { uIOhook, UiohookKey } from 'uiohook-napi'
import { acquireHook, releaseHook } from '../uiohook-lifecycle'

const MODIFIER_CODES: Set<number> = new Set([
  UiohookKey.Ctrl,
  UiohookKey.CtrlRight,
  UiohookKey.Shift,
  UiohookKey.ShiftRight,
  UiohookKey.Alt,
  UiohookKey.AltRight,
  UiohookKey.Meta,
  UiohookKey.MetaRight,
  UiohookKey.CapsLock,
  UiohookKey.NumLock,
  UiohookKey.ScrollLock,
])

const CODE_TO_NAME: Map<number, string> = new Map(
  Object.entries(UiohookKey)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    .map(([name, code]) => [code, name]),
)

let activeEmit: ((event: ShortcutRecordEvent) => void) | null = null
let keyDownListener: ((e: UiohookKeyboardEvent) => void) | null = null
let keyUpListener: ((e: UiohookKeyboardEvent) => void) | null = null
let hookAcquired = false

const activeChords = new Map<number, KeyboardShortcutChord>()

/**
 * 录制期间监听真实键盘 down/up。
 * 该事件流只表达“捕获到了什么”，具体判定 press / doublePress / hold 由渲染层按 action 能力完成
 */
export function startRecordShortcutDetection(emit: (event: ShortcutRecordEvent) => void): void {
  if (activeEmit)
    return

  activeEmit = emit
  keyDownListener = handleKeyDown
  keyUpListener = handleKeyUp

  uIOhook.on('keydown', keyDownListener)
  uIOhook.on('keyup', keyUpListener)

  if (!hookAcquired) {
    acquireHook()
    hookAcquired = true
  }
}

/**
 * 录制结束，移除监听器并释放 uIOhook
 */
export function stopRecordShortcutDetection(): void {
  if (keyDownListener) {
    uIOhook.off('keydown', keyDownListener)
    keyDownListener = null
  }

  if (keyUpListener) {
    uIOhook.off('keyup', keyUpListener)
    keyUpListener = null
  }

  activeEmit = null
  activeChords.clear()

  if (hookAcquired) {
    releaseHook()
    hookAcquired = false
  }
}

function handleKeyDown(event: UiohookKeyboardEvent): void {
  if (!activeEmit)
    return
  if (MODIFIER_CODES.has(event.keycode))
    return
  if (activeChords.has(event.keycode))
    return

  const chord = toKeyboardShortcutChord(event)
  if (!chord)
    return

  activeChords.set(event.keycode, chord)
  activeEmit({
    phase: 'down',
    chord,
    timestamp: Date.now(),
  })
}

function handleKeyUp(event: UiohookKeyboardEvent): void {
  if (!activeEmit)
    return

  const chord = activeChords.get(event.keycode)
  if (!chord)
    return

  activeChords.delete(event.keycode)
  activeEmit({
    phase: 'up',
    chord,
    timestamp: Date.now(),
  })
}

function toKeyboardShortcutChord(event: UiohookKeyboardEvent): KeyboardShortcutChord | null {
  const key = keycodeToName(event.keycode)
  if (!key)
    return null

  return {
    source: 'keyboard',
    key,
    modifiers: getModifiers(event),
  }
}

function keycodeToName(keycode: number): string | null {
  return CODE_TO_NAME.get(keycode) ?? null
}

function getModifiers(event: UiohookKeyboardEvent): ShortcutModifier[] {
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
