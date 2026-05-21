import type { IpcContract } from '@ipc/core'

export type ShortcutTestPayload = {
  /** 触发类型：hold / doublePress / combo */
  triggerType: 'hold' | 'doublePress' | 'combo'
  /** 显示文本，如 "Hold Triggered" / "Combo: Space" */
  label: string
}

export type ShortcutTestContract = IpcContract<
  {},
  {
    trigger: ShortcutTestPayload
  }
>
