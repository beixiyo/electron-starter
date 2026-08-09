import type { IpcContract } from '@ipc/core'
import type { SelectionData } from '@shared'

export type SelectionContract = IpcContract<{
  mainHandle: {
    showSelectionWindow: (text: string) => { success: boolean, error?: string }
    closeSelectionWindow: () => { success: boolean, error?: string }
  }
  rendererOn: {
    data: SelectionData
  }
}>
