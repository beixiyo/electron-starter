import type { IpcContract } from '@ipc/core'
import type { FnComboKey, Modifier as NativeModifier } from '@ipc/services/fn/contract'

export type { FnComboKey }

export const DEFAULT_BINDINGS: ShortcutBindings = {
  recording: { gesture: 'press', chord: { source: 'fn', key: 'Space' } },
  askAssistant: { gesture: 'doublePress', chord: { source: 'fn', key: 'Fn' } },
  voiceDictation: { gesture: 'hold', chord: { source: 'fn', key: 'Fn' } },
  bookmark: { gesture: 'press', chord: { source: 'fn', key: 'Grave' } },
}

export function shortcutChordsEqual(a: ShortcutChord, b: ShortcutChord): boolean {
  return a.source === b.source
    && a.key === b.key
    && shortcutModifiersEqual(a.modifiers ?? [], b.modifiers ?? [])
}

export function shortcutModifiersEqual(a: ShortcutModifier[], b: ShortcutModifier[]): boolean {
  const left = normalizeShortcutModifiers(a)
  const right = normalizeShortcutModifiers(b)

  return left.length === right.length
    && left.every((modifier, index) => modifier === right[index])
}

function normalizeShortcutModifiers(modifiers: ShortcutModifier[]): ShortcutModifier[] {
  return Array.from(new Set(modifiers)).sort()
}

export type ShortcutConfigContract = IpcContract<{
  getBindings: () => ShortcutBindings
  setBindings: (bindings: ShortcutBindings) => void
  /** 录制快捷键前调用，阻止主进程响应 fn 事件 */
  pauseForRecord: () => void
  /** 录制结束后调用，恢复主进程响应 */
  resumeAfterRecord: () => void
}, {
  /** 主进程检测到修饰键组合，推送给录制中的渲染进程 */
  hotkey: KeyboardShortcutChord
}>

/** 快捷键修饰键，`Primary` 表示 macOS Command、Windows/Linux Control */
export type ShortcutModifier = NativeModifier | 'Primary'

/** 兼容旧代码中对 Modifier 的导入，语义已扩展为支持 `Primary` */
export type Modifier = ShortcutModifier

/** 普通键盘快捷键 chord */
export type KeyboardShortcutChord = {
  source: 'keyboard'
  key: string
  modifiers: ShortcutModifier[]
}

/** Fn/Globe 快捷键 chord，`Fn` 表示 Fn 键自身 */
export type FnShortcutChord = {
  source: 'fn'
  key: FnShortcutKey
  modifiers?: ShortcutModifier[]
}

/** 统一快捷键 chord */
export type ShortcutChord = KeyboardShortcutChord | FnShortcutChord

/** Fn chord 支持的按键集合 */
export type FnShortcutKey = 'Fn' | FnComboKey

/** 快捷键手势类型 */
export type ShortcutGestureType = 'press' | 'hold' | 'doublePress'

/** 新版快捷键绑定，使用 gesture + chord 表达任意按键的 press/hold/doublePress */
export type ShortcutBinding = {
  gesture: ShortcutGestureType
  chord: ShortcutChord
  /** @default 300 */
  intervalMs?: number
  /** @default 300 */
  minDurationMs?: number
}

/** action id → 绑定，null 表示禁用 */
export type ShortcutBindings = Record<string, ShortcutBinding | null>
