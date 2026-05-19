export type FocusDemoPayload = {
  focused: boolean
  role: string | null
  app: string | null
  bundleId: string | null
  isSelf: boolean
}

export const FOCUS_DEMO_CHANNEL = {
  UPDATE: 'focus-demo:update',
} as const
