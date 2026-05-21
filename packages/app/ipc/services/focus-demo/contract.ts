import type { IpcContract } from '@ipc/core'

export type FocusDemoPayload = {
  focused: boolean
  role: string | null
  app: string | null
  bundleId: string | null
  isSelf: boolean
}

export type FocusDemoContract = IpcContract<
  {},
  {
    update: FocusDemoPayload
  }
>
