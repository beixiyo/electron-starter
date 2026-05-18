export type ShortcutTestPayload = {
  /** 触发类型：hold / doublePress / combo */
  triggerType: 'hold' | 'doublePress' | 'combo'
  /** 显示文本，如 "Hold Triggered" / "Combo: Space" */
  label: string
}

export const SHORTCUT_TEST_CHANNEL = {
  TRIGGER: 'shortcut-test:trigger',
} as const

export type ShortcutTestChannel = typeof SHORTCUT_TEST_CHANNEL[keyof typeof SHORTCUT_TEST_CHANNEL]
