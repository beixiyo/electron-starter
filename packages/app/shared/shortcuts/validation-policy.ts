/**
 * 快捷键录制策略：全部禁用规则，以及哪些键允许录成双击
 *
 * 改规则只动这个文件，`validation.ts` 是不含任何具体按键的执行引擎
 *
 * - 规则按数组顺序逐条判定，命中即返回该条 `code`，不再往下查
 * - `code` 约定同时作为设置页提示文案的 i18n key（如 `<命名空间>.<code>`），
 *   新增原因要同步补上对应文案
 * - 与本项当前快捷键相同的组合在进入规则前就放行，不用在这里为它写例外
 */

import type { KeyboardCode, KeyboardInputKey, ShortcutInputSource, ShortcutModifier } from './types'
import { KEYBOARD_CODES } from './types'

/** 常用键组，供规则按组引用；新增分组直接往这里加 */
export const SHORTCUT_KEY_GROUPS = {
  letters: KEYBOARD_CODES.filter(code => /^[A-Z]$/.test(code)),
  digits: KEYBOARD_CODES.filter(code => /^[0-9]$/.test(code)),
  numpadDigits: KEYBOARD_CODES.filter(code => /^Numpad[0-9]$/.test(code)),
  /** F1–F19；F20–F24 不在其中，常规键盘上没有它们 */
  functionKeys: KEYBOARD_CODES.filter(code => /^F([1-9]|1[0-9])$/.test(code)),
} as const satisfies Record<string, readonly KeyboardCode[]>

/**
 * 录制校验规则，数组顺序即判定顺序；表里没写的组合一律放行
 *
 * 三种规则：
 * - `maxKeys`：键数超过 `max` 不通过，修饰键、fn 与一起按住的普通键各算一个
 * - `inUse`：与其他动作的当前快捷键相同不通过
 * - `deny`：命中 `patterns` 任一模式不通过；`systemShortcuts: true` 时把主进程实时读到的
 *   系统快捷键也算进模式里；`except` 命中的组合跳过本条
 *
 * 多个普通键一起按住（`[ + ]`、`A + 2`）是一个 chord：模式的 `key` 要求主键与每个成员都命中
 * （`A + 2` 才算「只有字母数字」，`Esc + A` 不算单独的 Esc），`keys: 'none'` 只匹配单个主键
 */
export const SHORTCUT_RECORD_RULES = [
  { code: 'tooManyKeys', kind: 'maxKeys', max: 3 },
  {
    code: 'alphanumericOnly',
    kind: 'deny',
    patterns: [
      {
        source: 'keyboard',
        key: [
          ...SHORTCUT_KEY_GROUPS.letters,
          ...SHORTCUT_KEY_GROUPS.digits,
          ...SHORTCUT_KEY_GROUPS.numpadDigits,
        ],
        modifiers: 'none',
      },
    ],
  },
  { code: 'alreadyInUse', kind: 'inUse' },
  {
    code: 'systemReserved',
    kind: 'deny',
    /**
     * 单独按下即归系统所有的键，只保留最基础的五个
     *
     * 单独的方向键、标点、F 键都放行；`Esc + A` 这类带成员的组合不算单独按下，
     * `keys: 'none'` 让它们不命中本条
     */
    patterns: [
      {
        source: 'keyboard',
        key: ['Escape', 'Space', 'Tab', 'Backspace', 'Enter'],
        modifiers: 'none',
        keys: 'none',
      },
    ],
    systemShortcuts: true,
    /**
     * fn + F1–F19 录入后由本应用接管，原亮度、音量等硬件功能不再响应
     *
     * 必须写成例外：用户改过的「显示桌面 fn+F11」之类会以 fn 掩码落进系统配置，
     * 不排除的话实时读取那一路会把它们判成保留键
     */
    except: [
      { source: 'fn', key: SHORTCUT_KEY_GROUPS.functionKeys },
    ],
  },
] as const satisfies readonly ShortcutRecordRule[]

/**
 * 允许录成双击的 chord；不在列表里的键按下即判单击，不等第二次
 *
 * 默认只给裸 fn 开双击（`fn + fn`），⌘ ⌃ ⌥ ⇧ 这类修饰键连击容易和系统行为撞车
 */
export const SHORTCUT_DOUBLE_PRESS_CHORDS = [
  { source: 'fn', key: 'Fn', modifiers: 'none' },
] as const satisfies readonly ShortcutChordPattern[]

/** 校验失败原因，与设置页提示文案一一对应 */
export type ShortcutValidationCode = typeof SHORTCUT_RECORD_RULES[number]['code']

/**
 * 一条 chord 匹配模式，省略的字段表示不限
 *
 * 纯修饰键组合的主键是带侧别的物理修饰键（如单独 ⌘ 是 `MetaLeft` 或 `MetaRight`）；
 * `modifiers` 写逻辑修饰键即可，录制得到的 `MetaLeft` 等物理侧别按家族匹配
 */
export type ShortcutChordPattern = {
  /** 输入源；省略表示 keyboard 与 fn 都匹配 */
  source?: ShortcutInputSource
  /** 主键与每个一起按住的普通键成员都要在其中，单个或任一；省略表示不限 */
  key?: ShortcutPatternKey | readonly ShortcutPatternKey[]
  /**
   * 修饰键约束：`none` 不能带修饰键，`any` 不限，数组表示恰好是这一组
   * @default 'any'
   */
  modifiers?: 'none' | 'any' | readonly ShortcutModifier[]
  /**
   * 一起按住的普通键成员约束（`[ + ]` 里的 `]`）：`none` 只能是单个主键，`any` 不限
   * @default 'any'
   */
  keys?: 'none' | 'any'
}

/** 模式里能出现的主键：规范键名，外加只有 Fn chord 才有的 `Fn` */
export type ShortcutPatternKey = KeyboardInputKey

export type ShortcutRecordRule =
  | ShortcutMaxKeysRule
  | ShortcutInUseRule
  | ShortcutDenyRule

export type ShortcutMaxKeysRule = {
  code: string
  kind: 'maxKeys'
  /** 允许的最大键数，修饰键、fn 与一起按住的普通键各算一个 */
  max: number
}

export type ShortcutInUseRule = {
  code: string
  kind: 'inUse'
}

export type ShortcutDenyRule = {
  code: string
  kind: 'deny'
  /** 命中任一模式即不通过 */
  patterns?: readonly ShortcutChordPattern[]
  /**
   * 是否把主进程实时读到的系统快捷键也算作禁用组合
   * @default false
   */
  systemShortcuts?: boolean
  /** 命中任一模式时跳过本条规则 */
  except?: readonly ShortcutChordPattern[]
}
