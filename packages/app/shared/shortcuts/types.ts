/** Fn 组合键触发时可能附带的修饰符 */
export type FnModifier = 'Meta' | 'Control' | 'Alt' | 'Shift'

/** 与 native/mac/fn-listener.swift COMBO_KEYS 保持一一对应 */
export const FN_COMBO_KEYS = [
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'I',
  'J',
  'K',
  'L',
  'M',
  'N',
  'O',
  'P',
  'Q',
  'R',
  'S',
  'T',
  'U',
  'V',
  'W',
  'X',
  'Y',
  'Z',
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  'Enter',
  'Escape',
  'Backspace',
  'Tab',
  'Space',
  'Minus',
  'Equal',
  'LeftBracket',
  'RightBracket',
  'Backslash',
  'Semicolon',
  'Quote',
  'Grave',
  'Comma',
  'Period',
  'Slash',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Delete',
  'Left',
  'Right',
  'Up',
  'Down',
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12',
] as const

/** 与 native/mac/fn-listener.swift COMBO_KEYS 保持一一对应 */
export type FnComboKey = typeof FN_COMBO_KEYS[number]

/** 快捷键修饰键，`Primary` 表示 macOS Command、Windows/Linux Control */
export type ShortcutModifier = FnModifier | 'Primary'

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
export const FN_SHORTCUT_KEYS = ['Fn', ...FN_COMBO_KEYS] as const

/** Fn chord 支持的按键集合 */
export type FnShortcutKey = typeof FN_SHORTCUT_KEYS[number]

/** 快捷键手势类型 */
export type ShortcutGestureType = 'press' | 'hold' | 'doublePress'

/** 所有内置快捷键手势 */
export const SHORTCUT_GESTURES = ['press', 'doublePress', 'hold'] as const satisfies readonly ShortcutGestureType[]

/** 快捷键生效范围 */
export type ShortcutScope = 'global' | 'local'

/** 快捷键手势绑定，不包含运行 scope，适合录制阶段表达“用户按了什么” */
export type ShortcutGestureBinding = {
  gesture: ShortcutGestureType
  chord: ShortcutChord
  /** @default 300 */
  intervalMs?: number
  /** @default 300 */
  minDurationMs?: number
}

/** 快捷键绑定，使用 scope + gesture + chord 表达运行位置、触发方式和按键组合 */
export type ShortcutBinding = ShortcutGestureBinding & {
  /** Electron 桌面支持 global / local；Web 只支持 local */
  scope: ShortcutScope
}

/** action id → 绑定，null 表示禁用 */
export type ShortcutBindings = Record<string, ShortcutBinding | null>

/** 录制阶段的输入事件，由 native/uIOhook/browser backend 产生，renderer 按 action 能力判定最终手势 */
export type ShortcutRecordEvent = {
  phase: ShortcutRecordPhase
  chord: ShortcutChord
  timestamp: number
}

/** 录制阶段的输入事件相位；`press` 表示 backend 只能报告一次完整按压 */
export type ShortcutRecordPhase = 'down' | 'up' | 'press'

/** runtime 触发事件相位 */
export type ShortcutRuntimePhase = 'trigger' | 'release'

/** 快捷键 runtime 触发事件，所有 backend 都应派发这一种结构 */
export type ShortcutRuntimeEvent = {
  /** action id */
  id: string
  /** trigger 表示已触发，release 仅用于 hold 松开 */
  phase: ShortcutRuntimePhase
  /** 实际触发手势 */
  gesture: ShortcutGestureType
  /** 已匹配的持久化 binding */
  binding: ShortcutBinding
}

/** 快捷键输入源 */
export type ShortcutInputSource = ShortcutChord['source']

/** 快捷键运行平台 */
export type ShortcutRuntimePlatform = 'electron' | 'web'

/** 单个 scope 下每类输入源支持的手势 */
export type ShortcutScopeCapabilities = Record<ShortcutInputSource, ShortcutGestureType[]>

/** 快捷键捕获 provider 声明，用于诊断和能力展示 */
export type ShortcutRuntimeProviderDescriptor = {
  /** provider 标识 */
  id: string
  /** provider 负责的输入源 */
  source: ShortcutInputSource
  /** provider 能处理的 scope；真实启用仍由 capabilities 判断 */
  scopes: readonly ShortcutScope[]
}

/** 当前 runtime 可提供的快捷键捕获能力 */
export type ShortcutRuntimeCapabilities = {
  platform: ShortcutRuntimePlatform
  scopes: Record<ShortcutScope, ShortcutScopeCapabilities>
  providers: ShortcutRuntimeProviderDescriptor[]
}
