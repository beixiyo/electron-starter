import type { IpcContract } from '@ipc/core'

export type ShortcutTestPayload = {
  /** 触发类型 */
  triggerType: 'hold' | 'doublePress' | 'combo' | 'hotkey'
  /** 显示文本，如 "Hold Triggered" / "Combo: Space" */
  label: string
}

export type ShortcutTestContract = IpcContract<
  {},
  {
    trigger: ShortcutTestPayload
  }
>
