import type { IpcContract } from '@ipc/core'
import type { OAuthCallbackParams } from '@shared'

export type OAuthContract = IpcContract<{}, {
  callback: OAuthCallbackParams
}>
