import type { IpcContract } from '@ipc/core'

export type FnContract = IpcContract<{}, {
  down: undefined
  up: undefined
  doublePress: undefined
}>
