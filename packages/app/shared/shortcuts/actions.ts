import type { ShortcutBinding, ShortcutGestureBinding, ShortcutGestureType, ShortcutScope } from './types'
import { canShortcutChordDoublePress } from './validation'

export const SHORTCUT_ACTIONS = [
  {
    id: 'recording',
    label: '录音',
    scope: 'global',
    activation: 'trigger',
    binding: { chord: { source: 'fn', key: 'Space' } },
    keyboardBinding: { chord: { source: 'keyboard', key: 'R', modifiers: ['Primary', 'Shift'] } },
  },
  {
    id: 'assistant',
    label: '助手',
    scope: 'global',
    activation: 'trigger',
    /** 裸 Fn 保留双击；普通键盘默认值使用单击，避免双击白名单拒绝默认值 */
    binding: { gesture: 'doublePress', chord: { source: 'fn', key: 'Fn' } },
    keyboardBinding: { chord: { source: 'keyboard', key: 'A', modifiers: ['Primary', 'Shift'] } },
  },
  {
    id: 'voiceDictation',
    label: '语音听写',
    scope: 'global',
    activation: 'toggle',
    binding: { chord: { source: 'fn', key: 'Fn' } },
    keyboardBinding: { chord: { source: 'keyboard', key: 'V', modifiers: ['Primary', 'Shift'] } },
  },
  {
    id: 'bookmark',
    label: '标记',
    scope: 'global',
    activation: 'trigger',
    binding: { chord: { source: 'fn', key: 'Backquote' } },
    keyboardBinding: { chord: { source: 'keyboard', key: 'B', modifiers: ['Primary', 'Shift'] } },
  },
] as const satisfies readonly ShortcutActionDefinition[]

export const MAC_DEFAULT_BINDINGS = Object.fromEntries(
  SHORTCUT_ACTIONS.map(action => [action.id, toShortcutActionBinding(action, action.binding)]),
) as ShortcutBindingsByAction

/** Windows、Linux 和 Web 默认使用普通键盘，避免依赖 macOS Fn helper */
export const DEFAULT_KEYBOARD_BINDINGS = Object.fromEntries(
  SHORTCUT_ACTIONS.map(action => [
    action.id,
    toShortcutActionBinding(action, action.keyboardBinding),
  ]),
) as ShortcutBindingsByAction

/** 当前运行平台的默认绑定 */
export const DEFAULT_BINDINGS = detectShortcutDefaultPlatform() === 'darwin'
  ? MAC_DEFAULT_BINDINGS
  : DEFAULT_KEYBOARD_BINDINGS

/** 给录制结果补上 action 声明的生效范围；默认绑定可显式覆盖激活方式的手势 */
export function toShortcutActionBinding(
  action: Pick<ShortcutActionDefinition, 'activation' | 'scope'>,
  binding: ShortcutGestureBinding | ShortcutActionInputBinding | null,
): ShortcutBinding | null {
  if (!binding)
    return null

  const gesture = binding.gesture ?? getShortcutActionGesture(action)

  return { ...binding, gesture, scope: action.scope }
}

/** hold / toggle 的交互语义固定手势；普通 trigger 默认使用单击 */
export function getShortcutActionGesture(
  action: Pick<ShortcutActionDefinition, 'activation'>,
): ShortcutGestureType {
  return action.activation === 'hold'
    ? 'hold'
    : 'press'
}

/** 设置页允许录制的手势由 action 激活方式决定；普通动作额外允许裸 Fn 双击 */
export function getShortcutActionRecordGestures(
  action: Pick<ShortcutActionDefinition, 'activation'>,
): ShortcutGestureType[] {
  return action.activation === 'hold'
    ? ['hold']
    : ['press', 'doublePress']
}

/** 判断绑定的手势是否满足 action 声明；按键本身的合法性由录制校验负责 */
export function isShortcutGestureBindingSupportedByAction(
  action: Pick<ShortcutActionDefinition, 'activation'>,
  binding: ShortcutGestureBinding,
): boolean {
  if (!getShortcutActionRecordGestures(action).includes(binding.gesture))
    return false

  return binding.gesture !== 'doublePress' || canShortcutChordDoublePress(binding.chord)
}

/** 内置快捷键 action id */
export type ShortcutActionId = typeof SHORTCUT_ACTIONS[number]['id']

/** 内置快捷键 action 定义 */
export type ShortcutActionDefinition = {
  readonly id: string
  readonly label: string
  /** 动作是否需要在应用不处于前台时触发 */
  readonly scope: ShortcutScope
  /** `trigger` 每次执行动作；`hold` 按住生效；`toggle` 在开始和结束间切换 */
  readonly activation: 'trigger' | 'hold' | 'toggle'
  /** 默认绑定；未显式指定 gesture 时由 activation 补全 */
  readonly binding: ShortcutActionInputBinding | null
  /** 非 macOS 平台和 Web 默认使用普通键盘绑定 */
  readonly keyboardBinding: ShortcutActionInputBinding
}

/** 内置 action 的输入绑定；默认手势可省略，也可为特殊默认值显式指定 */
export type ShortcutActionInputBinding = Omit<ShortcutGestureBinding, 'gesture'> & {
  readonly gesture?: ShortcutGestureType
}

/** 内置 action 的绑定集合 */
export type ShortcutBindingsByAction = Record<ShortcutActionId, ShortcutBinding | null>

function detectShortcutDefaultPlatform(): 'darwin' | 'other' {
  const maybeProcess = globalThis as typeof globalThis & { process?: { platform?: string } }
  if (maybeProcess.process?.platform) {
    return maybeProcess.process.platform === 'darwin'
      ? 'darwin'
      : 'other'
  }

  const maybeNavigator = globalThis as typeof globalThis & { navigator?: { platform?: string, userAgent?: string } }
  const platform = maybeNavigator.navigator?.platform ?? ''
  const userAgent = maybeNavigator.navigator?.userAgent ?? ''
  return /Mac|iPhone|iPad|iPod/i.test(platform) || /Mac OS X/i.test(userAgent)
    ? 'darwin'
    : 'other'
}
