import type { Modifier, ShortcutBindings } from '@ipc/services/shortcut-config/contract'
import { globalShortcut } from 'electron'
import { isSuspended } from './fn-listener'

function toAccelerator(modifiers: Modifier[], key: string): string {
  const parts: string[] = []
  if (modifiers.includes('Meta'))
    parts.push('Command')
  if (modifiers.includes('Control'))
    parts.push('Control')
  if (modifiers.includes('Alt'))
    parts.push('Alt')
  if (modifiers.includes('Shift'))
    parts.push('Shift')

  const KEY_MAP: Record<string, string> = {
    Enter: 'Return',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
  }

  return [...parts, KEY_MAP[key] ?? key].join('+')
}

let registeredAccelerators: string[] = []

export function registerHotkeyShortcuts(
  bindings: ShortcutBindings,
  handlers: Record<string, () => void>,
): void {
  unregisterHotkeyShortcuts()

  for (const [id, binding] of Object.entries(bindings)) {
    if (binding?.type !== 'hotkey')
      continue
    const onTrigger = handlers[id]
    if (!onTrigger)
      continue

    const accelerator = toAccelerator(binding.modifiers, binding.key)
    try {
      const ok = globalShortcut.register(accelerator, () => {
        if (isSuspended())
          return
        onTrigger()
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
  registeredAccelerators = []
}
