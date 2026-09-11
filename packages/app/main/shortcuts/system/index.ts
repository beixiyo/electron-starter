/**
 * macOS 当前启用的系统快捷键，供录制时校验用户是否按到了系统保留键
 *
 * 数据源是 `com.apple.symbolichotkeys` 偏好域，用 `plutil` 转成 JSON 后解码。
 * 只认 plist 里**显式写了按键**的条目：macOS 对「从未被用户改过的系统默认快捷键」
 * 不落盘按键，只落 `{ enabled: true }`，那部分默认值存在系统私有实现里，读不到。
 * 这里宁可漏报也不猜——猜错会把一个完全可用的组合判成保留键，用户永远设不上；
 * 漏掉的那部分退化成「系统优先、本 App 不触发」，与其他应用热键的处置一致
 *
 * 本模块只提供读取与解码，录制流程的接线由调用方自行完成
 */

import type { FnModifier, KeyboardCode, ShortcutChord } from '@shared/shortcuts'
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { isRecord } from '@jl-org/tool'
import { isFnShortcutKey, normalizeKeyboardShortcutChord } from '@shared/shortcuts'
import { MAC_MODIFIER_FLAGS, MAC_VIRTUAL_KEY_CODES } from './mac-keycodes'

const execFileAsync = promisify(execFile)

const SYMBOLIC_HOTKEYS_PLIST = join(homedir(), 'Library', 'Preferences', 'com.apple.symbolichotkeys.plist')

let cached: readonly ShortcutChord[] = []

/** 最近一次读取到的系统快捷键；未刷新过时为空 */
export function getMacSystemShortcuts(): readonly ShortcutChord[] {
  return cached
}

/**
 * 重新读取系统快捷键并更新缓存
 *
 * 非 macOS、plist 不存在或解码失败都保持上一次的结果，让校验退回静态保留键
 */
export async function refreshMacSystemShortcuts(): Promise<readonly ShortcutChord[]> {
  if (process.platform !== 'darwin')
    return cached

  try {
    const { stdout } = await execFileAsync('plutil', ['-convert', 'json', '-o', '-', SYMBOLIC_HOTKEYS_PLIST])
    cached = parseSymbolicHotKeys(JSON.parse(stdout))
  }
  catch {}

  return cached
}

/** 把 `AppleSymbolicHotKeys` 解码为 chord 列表，跳过禁用项与无法归一的键 */
export function parseSymbolicHotKeys(payload: unknown): ShortcutChord[] {
  const entries = isRecord(payload) && isRecord(payload.AppleSymbolicHotKeys)
    ? payload.AppleSymbolicHotKeys
    : null
  if (!entries)
    return []

  const chords: ShortcutChord[] = []

  for (const entry of Object.values(entries)) {
    if (!isRecord(entry) || entry.enabled === false)
      continue

    const chord = toShortcutChord(entry.value)
    if (chord)
      chords.push(chord)
  }

  return chords
}

/**
 * `value.parameters` 是 `[ascii, keycode, modifierMask]`
 *
 * 只处理 `type: 'standard'`：`modifier` 类型描述的是「单独按某个修饰键做什么」
 * （fn 弹输入法菜单就是这条），把它算成保留键会让以裸 Fn 为默认值的绑定自己非法
 */
function toShortcutChord(value: unknown): ShortcutChord | null {
  if (!isRecord(value) || value.type !== 'standard' || !Array.isArray(value.parameters))
    return null

  const [, keyCode, modifierMask] = value.parameters
  if (typeof keyCode !== 'number' || typeof modifierMask !== 'number')
    return null

  const key: KeyboardCode | undefined = MAC_VIRTUAL_KEY_CODES[keyCode]
  if (!key)
    return null

  const modifiers: FnModifier[] = []
  if (modifierMask & MAC_MODIFIER_FLAGS.meta)
    modifiers.push('Meta')
  if (modifierMask & MAC_MODIFIER_FLAGS.control)
    modifiers.push('Control')
  if (modifierMask & MAC_MODIFIER_FLAGS.alt)
    modifiers.push('Alt')
  if (modifierMask & MAC_MODIFIER_FLAGS.shift)
    modifiers.push('Shift')

  /** 带 fn 的系统快捷键（如 fn + F11）在本 App 里是 Fn 组合，两种 chord 结构不通用 */
  if (modifierMask & MAC_MODIFIER_FLAGS.fn) {
    return isFnShortcutKey(key)
      ? { source: 'fn', key, modifiers }
      : null
  }

  return normalizeKeyboardShortcutChord(key, modifiers)
}
