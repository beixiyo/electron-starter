import type { KeyboardShortcutChord, ShortcutBinding, ShortcutBindings, ShortcutGestureType } from '@ipc/services/shortcut-config/contract'
import {
  registerKeyboardGestureShortcut,
  unregisterKeyboardGestureShortcuts,
} from './gesture'

export function registerHotkeyShortcuts(
  bindings: ShortcutBindings,
  handlers: Record<string, (event: KeyboardHotkeyEvent) => void>,
): void {
  unregisterHotkeyShortcuts()

  for (const [id, binding] of Object.entries(bindings)) {
    if (!isKeyboardBinding(binding))
      continue

    const onShortcut = handlers[id]
    if (!onShortcut)
      continue

    registerKeyboardGestureShortcut({
      id,
      binding,
      onTrigger: (gesture) => {
        onShortcut({
          phase: 'trigger',
          gesture,
          binding,
        })
      },
      onRelease: (gesture) => {
        onShortcut({
          phase: 'release',
          gesture,
          binding,
        })
      },
    })
  }
}

export function unregisterHotkeyShortcuts(): void {
  unregisterKeyboardGestureShortcuts()
}

function isKeyboardBinding(
  binding: ShortcutBinding | null,
): binding is ShortcutBinding & { chord: KeyboardShortcutChord } {
  return !!binding && binding.chord.source === 'keyboard'
}

export type KeyboardHotkeyEvent = {
  /** trigger 表示已触发，release 仅用于 hold 松开 */
  phase: 'trigger' | 'release'
  /** 触发的手势 */
  gesture: ShortcutGestureType
  /** 原始持久化 binding */
  binding: ShortcutBinding & { chord: KeyboardShortcutChord }
}
