import type { ShortcutBinding } from '@shared/shortcuts'
import { BrowserWindow } from 'electron'
import { canUseFnShortcutBackend, canUseGlobalKeyboardShortcutBackend, canUseLocalKeyboardShortcutBackend } from './capabilities'

/** 按 backend 当前能力和 binding scope 判断当前是否允许执行快捷键动作 */
export function canTriggerShortcutBinding(binding: ShortcutBinding): boolean {
  if (!canUseShortcutBackend(binding))
    return false

  if (binding.scope === 'global')
    return true

  return BrowserWindow.getFocusedWindow() !== null
}

function canUseShortcutBackend(binding: ShortcutBinding): boolean {
  if (binding.chord.source === 'fn')
    return canUseFnShortcutBackend()

  return binding.scope === 'global'
    ? canUseGlobalKeyboardShortcutBackend()
    : canUseLocalKeyboardShortcutBackend()
}
