import type { ShortcutBinding, ShortcutGestureBinding, ShortcutGestureType, ShortcutScope } from './types'
import { SHORTCUT_GESTURES } from './types'

export const SHORTCUT_ACTIONS = [
  {
    id: 'recording',
    label: '录音',
    scope: 'global',
    activation: 'trigger',
    recordingChord: { fn: 'combination', keyboard: 'combination' },
    binding: { gesture: 'press', chord: { source: 'fn', key: 'Space' } },
    keyboardBinding: { gesture: 'press', chord: { source: 'keyboard', key: 'R', modifiers: ['Primary', 'Shift'] } },
    supportedGestures: SHORTCUT_GESTURES,
  },
  {
    id: 'askAssistant',
    label: 'Ask',
    scope: 'global',
    activation: 'trigger',
    recordingChord: { fn: 'single', keyboard: 'combination' },
    binding: { gesture: 'doublePress', chord: { source: 'fn', key: 'Fn' } },
    keyboardBinding: { gesture: 'doublePress', chord: { source: 'keyboard', key: 'A', modifiers: ['Primary', 'Shift'] } },
    supportedGestures: SHORTCUT_GESTURES,
  },
  {
    id: 'voiceDictation',
    label: '语音听写',
    scope: 'global',
    activation: 'toggle',
    recordingChord: { fn: 'single', keyboard: 'combination' },
    binding: { gesture: 'press', chord: { source: 'fn', key: 'Fn' } },
    keyboardBinding: { gesture: 'press', chord: { source: 'keyboard', key: 'V', modifiers: ['Primary', 'Shift'] } },
    supportedGestures: SHORTCUT_GESTURES,
  },
  {
    id: 'bookmark',
    label: '标记',
    scope: 'global',
    activation: 'trigger',
    recordingChord: { fn: 'combination', keyboard: 'combination' },
    binding: { gesture: 'press', chord: { source: 'fn', key: 'Grave' } },
    keyboardBinding: { gesture: 'press', chord: { source: 'keyboard', key: 'B', modifiers: ['Primary', 'Shift'] } },
    supportedGestures: SHORTCUT_GESTURES,
  },
  {
    id: 'screenshot',
    label: '截图',
    scope: 'global',
    activation: 'trigger',
    recordingChord: { fn: 'combination', keyboard: 'combination' },
    binding: { gesture: 'press', chord: { source: 'keyboard', key: 'A', modifiers: ['Primary', 'Shift'] } },
    keyboardBinding: { gesture: 'press', chord: { source: 'keyboard', key: 'S', modifiers: ['Primary', 'Shift'] } },
    supportedGestures: SHORTCUT_GESTURES,
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

/** 给录制结果补上 action 声明的生效范围 */
export function toShortcutActionBinding(
  action: Pick<ShortcutActionDefinition, 'activation' | 'scope'>,
  binding: ShortcutGestureBinding | null,
): ShortcutBinding | null {
  return binding
    ? { ...binding, gesture: getShortcutActionGesture(action, binding.gesture), scope: action.scope }
    : null
}

/** hold / toggle 的交互语义固定手势；普通 trigger 保留 action 声明的手势 */
export function getShortcutActionGesture(
  action: Pick<ShortcutActionDefinition, 'activation'>,
  triggerGesture: ShortcutGestureType,
): ShortcutGestureType {
  if (action.activation === 'hold')
    return 'hold'
  if (action.activation === 'toggle')
    return 'press'
  return triggerGesture
}

/** 设置页允许录制的手势由 action 激活方式决定 */
export function getShortcutActionSupportedGestures(
  action: Pick<ShortcutActionDefinition, 'activation' | 'supportedGestures'>,
): readonly ShortcutGestureType[] {
  if (action.activation === 'hold')
    return ['hold']
  if (action.activation === 'toggle')
    return ['press']
  return action.supportedGestures
}

/** 判断录制结果是否满足 action 声明的手势和按键形态 */
export function isShortcutGestureBindingSupportedByAction(
  action: Pick<ShortcutActionDefinition, 'activation' | 'recordingChord' | 'supportedGestures'>,
  binding: ShortcutGestureBinding,
): boolean {
  if (!getShortcutActionSupportedGestures(action).includes(binding.gesture))
    return false

  const isSingle = binding.chord.source === 'fn'
    ? binding.chord.key === 'Fn'
    : binding.chord.modifiers.length === 0

  return action.recordingChord[binding.chord.source] === 'single'
    ? isSingle
    : !isSingle
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
  /** 设置页允许录制的按键形态 */
  readonly recordingChord: Readonly<Record<'fn' | 'keyboard', 'single' | 'combination'>>
  /** macOS 默认绑定；scope 统一取自 action */
  readonly binding: ShortcutGestureBinding | null
  /** 非 macOS 平台和 Web 的普通键盘默认绑定 */
  readonly keyboardBinding: ShortcutGestureBinding
  readonly supportedGestures: readonly ShortcutGestureType[]
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
