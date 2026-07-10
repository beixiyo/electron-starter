import type { ShortcutBinding, ShortcutGestureType } from './types'
import { SHORTCUT_GESTURES } from './types'

export const SHORTCUT_ACTIONS = [
  {
    id: 'recording',
    label: '录音',
    binding: { scope: 'global', gesture: 'press', chord: { source: 'fn', key: 'Space' } },
    supportedGestures: SHORTCUT_GESTURES,
  },
  {
    id: 'askAssistant',
    label: 'Ask',
    binding: { scope: 'global', gesture: 'doublePress', chord: { source: 'fn', key: 'Fn' } },
    supportedGestures: SHORTCUT_GESTURES,
  },
  {
    id: 'voiceDictation',
    label: '语音听写',
    binding: { scope: 'global', gesture: 'hold', chord: { source: 'fn', key: 'Fn' } },
    supportedGestures: SHORTCUT_GESTURES,
  },
  {
    id: 'bookmark',
    label: '标记',
    binding: { scope: 'global', gesture: 'press', chord: { source: 'fn', key: 'Grave' } },
    supportedGestures: SHORTCUT_GESTURES,
  },
  {
    id: 'screenshot',
    label: '截图',
    binding: {
      scope: 'global',
      gesture: 'press',
      chord: { source: 'keyboard', key: 'A', modifiers: ['Primary', 'Shift'] },
    },
    supportedGestures: SHORTCUT_GESTURES,
  },
] as const satisfies readonly ShortcutActionDefinition[]

export const DEFAULT_BINDINGS = Object.fromEntries(
  SHORTCUT_ACTIONS.map(action => [action.id, action.binding]),
) as ShortcutBindingsByAction

/** 内置快捷键 action id */
export type ShortcutActionId = typeof SHORTCUT_ACTIONS[number]['id']

/** 快捷键 action 元数据，供 main / renderer 共用 */
export type ShortcutActionDefinition = {
  readonly id: string
  readonly label: string
  readonly binding: ShortcutBinding
  readonly supportedGestures: readonly ShortcutGestureType[]
}

/** 内置 action 默认绑定 */
export type ShortcutBindingsByAction = Record<ShortcutActionId, ShortcutBinding>
