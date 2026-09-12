import type { ShortcutBinding, ShortcutGestureType, ShortcutScope } from '@shared/shortcuts'
import { SHORTCUT_ACTIONS, toShortcutActionBinding } from '@shared/shortcuts'

export type { ShortcutBinding, ShortcutGestureBinding } from '@shared/shortcuts'

/** 设置页可录制的手势类型。 */
export type GestureType = ShortcutGestureType

/** 设置页展示的一条快捷键动作。 */
export type ShortcutAction = {
  id: string
  label: string
  /** 动作声明的生效范围，录制时不可由 UI 覆盖。 */
  scope: ShortcutScope
  /** 动作的触发语义。 */
  activation: 'trigger' | 'hold' | 'toggle'
  /** 当前绑定，null 表示未设置。 */
  binding: ShortcutBinding | null
  /** 该动作允许录制的手势。 */
  supportedGestures: readonly ShortcutGestureType[]
}

/** 内置快捷键动作的初始展示数据。 */
export const DEFAULT_ACTIONS: ShortcutAction[] = SHORTCUT_ACTIONS.map((action) => ({
  id: action.id,
  label: action.label,
  scope: action.scope,
  activation: action.activation,
  binding: toShortcutActionBinding(action, action.binding),
  supportedGestures: getRecordGestures(action),
}))

function getRecordGestures(action: Pick<ShortcutAction, 'activation'>): ShortcutGestureType[] {
  return action.activation === 'hold'
    ? ['hold']
    : ['press', 'doublePress']
}
