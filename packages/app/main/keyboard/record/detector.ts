import type { KeyboardShortcutChord, Modifier } from '@ipc/services/shortcut-config/contract'
import type { UiohookKeyboardEvent } from 'uiohook-napi'
import { uIOhook, UiohookKey } from 'uiohook-napi'
import { acquireHook, releaseHook } from '../uiohook-lifecycle'

export type RecordedHotkey = KeyboardShortcutChord

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

/** keycode → 显示名称（与渲染进程 normalizeHotkeyKey 保持一致） */
const CODE_TO_NAME: Map<number, string> = new Map(
  Object.entries(UiohookKey)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    .map(([name, code]) => [code, name]),
)

function keycodeToName(keycode: number): string | null {
  return CODE_TO_NAME.get(keycode) ?? null
}

let activeListener: ((e: UiohookKeyboardEvent) => void) | null = null
let hookAcquired = false

/**
 * 录制期间开始监听修饰键组合，通过 emit 回调上报
 */
export function startRecordHotkeyDetection(emit: (hotkey: RecordedHotkey) => void): void {
  if (activeListener)
    return

  activeListener = (e: UiohookKeyboardEvent) => {
    if (!e.metaKey && !e.ctrlKey && !e.altKey)
      return
    if (MODIFIER_CODES.has(e.keycode))
      return

    const key = keycodeToName(e.keycode)
    if (!key)
      return

    const modifiers: Modifier[] = []
    if (e.metaKey)
      modifiers.push('Meta')
    if (e.ctrlKey)
      modifiers.push('Control')
    if (e.altKey)
      modifiers.push('Alt')
    if (e.shiftKey)
      modifiers.push('Shift')

    emit({ source: 'keyboard', key, modifiers })
  }

  uIOhook.on('keydown', activeListener)

  if (!hookAcquired) {
    acquireHook()
    hookAcquired = true
  }
}

/**
 * 录制结束，移除监听器并释放 uIOhook
 */
export function stopRecordHotkeyDetection(): void {
  if (!activeListener)
    return

  uIOhook.off('keydown', activeListener)
  activeListener = null

  if (hookAcquired) {
    releaseHook()
    hookAcquired = false
  }
}
