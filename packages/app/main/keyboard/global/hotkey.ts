import type { KeyboardShortcutChord, ShortcutBindings, ShortcutModifier } from '@ipc/services/shortcut-config/contract'
import { globalShortcut } from 'electron'
import { isSuspended } from '../fn'
import { registerDoublePressGlobalShortcut, unregisterDoublePressGlobalShortcut } from './double'

function toAccelerator(chord: KeyboardShortcutChord): string {
  const parts: string[] = []
  const modifiers = normalizeModifiers(chord.modifiers)

  for (const modifier of modifiers) {
    parts.push(toAcceleratorModifier(modifier))
  }

  const KEY_MAP: Record<string, string> = {
    Enter: 'Return',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    Backquote: '`',
    BracketLeft: '[',
    BracketRight: ']',
  }

  return [...parts, KEY_MAP[chord.key] ?? chord.key].join('+')
}

function normalizeModifiers(modifiers: ShortcutModifier[]): ShortcutModifier[] {
  return Array.from(new Set(modifiers))
}

function toAcceleratorModifier(modifier: ShortcutModifier): string {
  switch (modifier) {
    case 'Primary':
      return 'CommandOrControl'
    case 'Meta':
      return process.platform === 'darwin'
        ? 'Command'
        : 'CommandOrControl'
    case 'Control':
      return 'Control'
    case 'Alt':
      return 'Alt'
    case 'Shift':
      return 'Shift'
  }
}

let registeredAccelerators: string[] = []
let registeredDoublePressAccelerators: string[] = []

export function registerHotkeyShortcuts(
  bindings: ShortcutBindings,
  handlers: Record<string, (gesture: KeyboardHotkeyGesture) => void>,
): void {
  unregisterHotkeyShortcuts()

  for (const [id, binding] of Object.entries(bindings)) {
    if (!binding || binding.chord.source !== 'keyboard')
      continue
    const onTrigger = handlers[id]
    if (!onTrigger)
      continue

    const accelerator = toAccelerator(binding.chord)

    if (binding.gesture === 'doublePress') {
      const ok = registerDoublePressGlobalShortcut({
        accelerator,
        intervalMs: binding.intervalMs,
        onDoublePress: () => {
          if (isSuspended())
            return
          onTrigger('doublePress')
        },
      })
      if (ok)
        registeredDoublePressAccelerators.push(accelerator)
      continue
    }

    if (binding.gesture !== 'press') {
      console.warn(`[hotkey] unsupported keyboard gesture (${binding.gesture}): ${accelerator}`)
      continue
    }

    try {
      const ok = globalShortcut.register(accelerator, () => {
        if (isSuspended())
          return
        onTrigger('press')
      })
      if (ok) {
        registeredAccelerators.push(accelerator)
      }
      else {
        console.warn(`[hotkey] ${accelerator} already taken`)
      }
    }
    catch (err) {
      console.error(`[hotkey] register error (${accelerator}):`, err)
    }
  }
}

export function unregisterHotkeyShortcuts(): void {
  for (const acc of registeredAccelerators) {
    try { globalShortcut.unregister(acc) }
    catch {}
  }
  for (const acc of registeredDoublePressAccelerators) {
    try { unregisterDoublePressGlobalShortcut(acc) }
    catch {}
  }
  registeredAccelerators = []
  registeredDoublePressAccelerators = []
}

type KeyboardHotkeyGesture = 'press' | 'doublePress'
