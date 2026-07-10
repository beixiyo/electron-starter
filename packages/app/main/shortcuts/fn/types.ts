import type { FnModifier, ShortcutGestureType } from '@shared/shortcuts'

/** Fn backend 的内部注册配置；只在 main 进程使用，不属于跨进程 shared 数据结构 */
export type FnShortcutsConfig = {
  hold?: {
    canStart?: () => boolean | Promise<boolean>
    onStart: () => void
    onRelease?: () => void
  }
  doublePress?: {
    onTrigger: () => void
  }
  combos?: FnShortcutComboConfig[]
}

export type FnShortcutComboConfig = {
  key: string
  /** 额外要求同时按住的修饰符（空 / undefined = 无修饰符） */
  modifiers?: FnModifier[]
  /** @default "press" */
  gesture?: Extract<ShortcutGestureType, 'press' | 'doublePress'>
  /** @default 300 */
  intervalMs?: number
  onTrigger: () => void
}
