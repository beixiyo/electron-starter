/** DOM KeyboardEvent → 统一原始输入：浏览器捕获后端的 adapter */

import type { FnModifier, KeyboardCode, KeyboardInputEvent, KeyboardInputPhase } from './types'
import { normalizeKeyboardCode } from './utils'

/**
 * 把一次 DOM 按键相位转换为统一原始输入
 *
 * 系统自动重复的 keydown 在这里过滤；DOM 拿不到 Fn/Globe，`fn` 恒为 false
 * 返回 null 表示该键不在规范键名空间内
 */
export function toBrowserKeyboardInputEvent(
  event: BrowserShortcutKeyEvent,
  phase: KeyboardInputPhase,
): KeyboardInputEvent | null {
  if (phase === 'down' && event.repeat)
    return null

  const key = normalizeBrowserShortcutKey(event)
  if (!key)
    return null

  return {
    phase,
    key,
    modifiers: getBrowserLogicalShortcutModifiers(event),
    fn: false,
    timestamp: Date.now(),
  }
}

/** 把浏览器 `code` 归一为规范键名；`code` 缺失时退回 `key` */
export function normalizeBrowserShortcutKey(event: BrowserShortcutKeyEvent): KeyboardCode | null {
  const { code, key } = event

  if (code.startsWith('Key'))
    return normalizeKeyboardCode(code.slice(3).toUpperCase())
  if (code.startsWith('Digit'))
    return normalizeKeyboardCode(code.slice(5))
  if (code)
    return normalizeKeyboardCode(code)
  if (key) {
    return normalizeKeyboardCode(key.length === 1
      ? key.toUpperCase()
      : key)
  }

  return null
}

/** 读取 DOM 事件的逻辑 modifier flags，不推断左右物理侧 */
export function getBrowserLogicalShortcutModifiers(
  event: BrowserShortcutKeyEvent,
): FnModifier[] {
  const modifiers: FnModifier[] = []

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

/** 浏览器 KeyboardEvent 的快捷键归一化所需字段子集 */
export type BrowserShortcutKeyEvent = {
  code: string
  key: string
  repeat?: boolean
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}
