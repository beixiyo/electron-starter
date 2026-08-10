import type { IpcContract } from '@ipc/core'
import type { FnComboKey, FnModifier, FnShortcutChord } from '@shared/shortcuts'

export type { FnComboKey, FnModifier, FnShortcutChord }

export type FnNativeInputEvent = {
  type: 'input'
  phase: 'down' | 'up'
  sequence: number
  timestamp: number
  chord: Omit<FnShortcutChord, 'modifiers'> & { modifiers: FnModifier[] }
}

export type FnNativeResetEvent = {
  type: 'reset'
  timestamp: number
}

export type FnNativeEvent = FnNativeInputEvent | FnNativeResetEvent

export type FnContract = IpcContract<{
  rendererOn: {
    raw: FnNativeEvent
  }
}>
