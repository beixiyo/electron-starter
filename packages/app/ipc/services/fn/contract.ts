import type { IpcContract } from '@ipc/core'
import type { FnComboKey, FnModifier } from '@shared/shortcuts'

export type { FnComboKey, FnModifier }

export type FnContract = IpcContract<{
  rendererOn: {
    down: undefined
    up: undefined
    combo: { key: FnComboKey, modifiers: FnModifier[] }
  }
}>
