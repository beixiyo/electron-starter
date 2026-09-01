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

/**
 * 普通键盘快捷键持久化使用的规范键名
 *
 * 这些值同时能由浏览器 `KeyboardEvent.code` 和 uIOhook 解析；浏览器的
 * `KeyA` / `Digit1` 等带前缀名称只在输入边界转换，不进入配置文件
 */
export const KEYBOARD_CODES = [
  'Backspace',
  'Tab',
  'Enter',
  'CapsLock',
  'Escape',
  'Space',
  'PageUp',
  'PageDown',
  'End',
  'Home',
  'ArrowLeft',
  'ArrowUp',
  'ArrowRight',
  'ArrowDown',
  'Insert',
  'Delete',
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
  'Numpad0',
  'Numpad1',
  'Numpad2',
  'Numpad3',
  'Numpad4',
  'Numpad5',
  'Numpad6',
  'Numpad7',
  'Numpad8',
  'Numpad9',
  'NumpadMultiply',
  'NumpadAdd',
  'NumpadSubtract',
  'NumpadDecimal',
  'NumpadDivide',
  'NumpadEnter',
  'NumpadEnd',
  'NumpadArrowDown',
  'NumpadPageDown',
  'NumpadArrowLeft',
  'NumpadArrowRight',
  'NumpadHome',
  'NumpadArrowUp',
  'NumpadPageUp',
  'NumpadInsert',
  'NumpadDelete',
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
  'F13',
  'F14',
  'F15',
  'F16',
  'F17',
  'F18',
  'F19',
  'F20',
  'F21',
  'F22',
  'F23',
  'F24',
  'Semicolon',
  'Equal',
  'Comma',
  'Minus',
  'Period',
  'Slash',
  'Backquote',
  'BracketLeft',
  'Backslash',
  'BracketRight',
  'Quote',
  'PrintScreen',
  'NumLock',
  'ScrollLock',
  'MetaLeft',
  'MetaRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'ShiftLeft',
  'ShiftRight',
] as const

/** 普通键盘快捷键的规范键名类型 */
export type KeyboardCode = typeof KEYBOARD_CODES[number]

/** 物理修饰键；顺序同时用于纯修饰键组合的稳定归一化 */
export const KEYBOARD_MODIFIER_CODES = [
  'MetaLeft',
  'MetaRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'ShiftLeft',
  'ShiftRight',
] as const satisfies readonly KeyboardCode[]

/** 带物理侧别的键盘修饰键 */
export type KeyboardModifierCode = typeof KEYBOARD_MODIFIER_CODES[number]

/** 输入边界的非规范键名到持久化键名的别名 */
export const KEYBOARD_CODE_ALIASES: Readonly<Record<string, KeyboardCode>> = {
  Grave: 'Backquote',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  LeftBracket: 'BracketLeft',
  RightBracket: 'BracketRight',
  Return: 'Enter',
  Esc: 'Escape',
  Del: 'Delete',
  CtrlLeft: 'ControlLeft',
  CtrlRight: 'ControlRight',
} as const

/** 作为主键使用时，对应的逻辑修饰键 */
export const KEYBOARD_MODIFIER_BY_CODE: Readonly<Partial<Record<KeyboardCode, FnModifier>>> = {
  MetaLeft: 'Meta',
  MetaRight: 'Meta',
  ControlLeft: 'Control',
  ControlRight: 'Control',
  AltLeft: 'Alt',
  AltRight: 'Alt',
  ShiftLeft: 'Shift',
  ShiftRight: 'Shift',
}

/** 键盘 chord 的 modifier；录制结果使用物理侧别，声明式默认值仍可使用逻辑修饰键 */
export type KeyboardShortcutModifier = ShortcutModifier | KeyboardModifierCode

/** 普通键盘快捷键 chord */
export type KeyboardShortcutChord = {
  source: 'keyboard'
  key: KeyboardCode
  modifiers: KeyboardShortcutModifier[]
}

/** 单个已按下物理键及其 keydown 时冻结的 keyboard chord */
export type ActiveKeyboardShortcutEntry = {
  key: KeyboardCode
  chord: KeyboardShortcutChord
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
export type ShortcutScopeCapabilities = Readonly<Record<ShortcutInputSource, readonly ShortcutGestureType[]>>

/** 快捷键捕获 provider 声明，用于诊断和能力展示 */
export type ShortcutRuntimeProviderDescriptor = {
  /** provider 标识 */
  readonly id: string
  /** provider 负责的输入源 */
  readonly source: ShortcutInputSource
  /** provider 能处理的 scope；真实启用仍由 capabilities 判断 */
  scopes: readonly ShortcutScope[]
}

/** 当前 runtime 可提供的快捷键捕获能力 */
export type ShortcutRuntimeCapabilities = {
  readonly platform: ShortcutRuntimePlatform
  readonly scopes: Readonly<Record<ShortcutScope, ShortcutScopeCapabilities>>
  readonly providers: readonly ShortcutRuntimeProviderDescriptor[]
}
