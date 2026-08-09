import type { IpcContract } from '@ipc/core'
import type { WindowType } from '@shared'

export type HoldContract = IpcContract<{
  rendererOn: {
    start: { windowType: WindowType }
    end: { windowType: WindowType }
  }
}>
