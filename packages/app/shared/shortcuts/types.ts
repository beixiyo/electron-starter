/** 快捷键领域模型：键名命名空间、chord、binding、原始输入事件与运行时事件 */

/** 逻辑修饰键，不区分左右侧 */
export type FnModifier = 'Meta' | 'Control' | 'Alt' | 'Shift'

/** 快捷键修饰键，`Primary` 表示 macOS Command、Windows/Linux Control */
export type ShortcutModifier = FnModifier | 'Primary'

/**
 * 全部键盘捕获后端共用的规范键名
 *
 * 取自 W3C `KeyboardEvent.code`，字母与数字去掉 `Key` / `Digit` 前缀。浏览器 `code`、
 * uIOhook 键码和 macOS 虚拟键码都只在各自 adapter 边界转换到这里，配置文件、IPC、
 * 录制与运行时全部使用同一套名字
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

/** 规范键名类型 */
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

/** 锁定键只切换状态、不参与 chord；所有捕获后端在进入 tracker 前统一丢弃 */
export const KEYBOARD_LOCK_CODES = [
  'CapsLock',
  'NumLock',
  'ScrollLock',
] as const satisfies readonly KeyboardCode[]

/** 锁定键键名 */
export type KeyboardLockCode = typeof KEYBOARD_LOCK_CODES[number]

/**
 * 能互相组成一个 chord 的普通键分组
 *
 * 同组的键同时按住合成一个 chord（方向键之间），跨组或组外的普通键同时按住仍是各自独立的
 * chord，录制时会被当成多主键组合拒绝。组内顺序用于成员的稳定归一化与展示
 */
export const KEYBOARD_CHORD_KEY_GROUPS = [
  ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'],
] as const satisfies readonly (readonly KeyboardCode[])[]

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

/** 可与 Fn 组成组合键的普通键：规范键名去掉修饰键与锁定键 */
export const FN_COMBO_KEYS = KEYBOARD_CODES.filter((code): code is FnComboKey => (
  !(KEYBOARD_MODIFIER_CODES as readonly string[]).includes(code)
  && !(KEYBOARD_LOCK_CODES as readonly string[]).includes(code)
))

/** Fn 组合键的主键 */
export type FnComboKey = Exclude<KeyboardCode, KeyboardModifierCode | KeyboardLockCode>

/** Fn chord 支持的按键集合，`Fn` 表示 Fn 键自身 */
export const FN_SHORTCUT_KEYS = ['Fn', ...FN_COMBO_KEYS] as const

/** Fn chord 支持的按键 */
export type FnShortcutKey = 'Fn' | FnComboKey

/** 键盘 chord 的 modifier；录制结果使用物理侧别，声明式默认值仍可使用逻辑修饰键 */
export type KeyboardShortcutModifier = ShortcutModifier | KeyboardModifierCode

/** 普通键盘快捷键 chord */
export type KeyboardShortcutChord = {
  source: 'keyboard'
  key: KeyboardCode
  modifiers: KeyboardShortcutModifier[]
  /**
   * 与主键同时按住的同组普通键，按 {@link KEYBOARD_CHORD_KEY_GROUPS} 组内顺序排列
   *
   * 只有与主键同组的键能出现，主键取组内最靠前的成员；省略等同于空
   */
  keys?: KeyboardCode[]
}

/** 单个已按下物理键及其 keydown 时冻结的 keyboard chord */
export type ActiveKeyboardShortcutEntry = {
  key: KeyboardCode
  chord: KeyboardShortcutChord
}

/**
 * Fn/Globe 快捷键 chord
 *
 * `key: 'Fn'` 表示 Fn 键自身是主键：不带 modifiers 是裸 Fn，带 modifiers 是 Fn 与修饰键的组合；
 * 其余 key 是 Fn 组合键的普通主键。修饰键一律是逻辑家族，不分左右侧
 */
export type FnShortcutChord = {
  source: 'fn'
  key: FnShortcutKey
  modifiers?: ShortcutModifier[]
}

/** 统一快捷键 chord */
export type ShortcutChord = KeyboardShortcutChord | FnShortcutChord

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

/** 原始输入事件里可能出现的键：规范键名，外加只有 macOS native 后端会产出的 `Fn` */
export type KeyboardInputKey = KeyboardCode | 'Fn'

/** 原始输入相位 */
export type KeyboardInputPhase = 'down' | 'up'

/**
 * 所有键盘捕获后端统一产出的原始物理输入
 *
 * 只描述物理事实，不含 chord、手势或 action 语义；每个 `down` 都是一次新的物理按下，
 * 系统自动重复由各后端在边界过滤。`fn` 表示该按键属于 Fn 组合，uIOhook 与 DOM 后端恒为 false
 */
export type KeyboardInputEvent = {
  phase: KeyboardInputPhase
  key: KeyboardInputKey
  /** 事件发生时按住的逻辑修饰键 */
  modifiers: FnModifier[]
  fn: boolean
  /**
   * 事件时刻，统一为 `Date.now()` 的 epoch 毫秒
   *
   * 时间基归一是**后端的职责**：平台时钟五花八门（macOS helper 报的是开机以来的
   * uptime 毫秒），必须在 adapter 边界换算成同一个基准再交给上层。否则 IPC 与 DOM
   * 两条路径混进同一个状态机时，`timestamp` 相减会得出上千亿毫秒，
   * 去重窗口永远不命中、轻点一下也会被判成 hold
   */
  timestamp: number
}

/** 后端丢失物理状态（helper 重启、系统禁用 tap）时发出，消费方应清空按键状态 */
export type KeyboardInputResetEvent = {
  phase: 'reset'
  /** 与 {@link KeyboardInputEvent.timestamp} 同一时间基 */
  timestamp: number
}

/** 键盘捕获后端向消费方派发的全部消息 */
export type KeyboardInput = KeyboardInputEvent | KeyboardInputResetEvent

/** 由 tracker 把原始输入合成后的 chord 事件，录制状态机与手势状态机只消费这一种结构 */
export type ShortcutRecordEvent = {
  phase: ShortcutRecordPhase
  chord: ShortcutChord
  timestamp: number
}

/** chord 事件相位；`press` 表示 backend 只能报告一次完整按压 */
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
