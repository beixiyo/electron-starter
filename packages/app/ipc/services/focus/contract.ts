import type { IpcContract } from '@ipc/core'

export type FocusPayload = {
  focused: boolean
  role: string | null
  app: string | null
  bundleId: string | null
  isSelf: boolean
}

export type FocusContract = IpcContract<
  {
    rendererOn: {
      update: FocusPayload
    }
  }
>
