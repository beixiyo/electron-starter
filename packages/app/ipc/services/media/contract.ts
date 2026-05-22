import type { IpcContract } from '@ipc/core'
import type { DesktopSourceOptions, DesktopSourceResponse, MediaSessionSnapshot, SaveBufferPayload } from '@shared'

export type MediaContract = IpcContract<{
  getSources: (options?: DesktopSourceOptions) => DesktopSourceResponse
  saveBuffer: (payload: SaveBufferPayload) => { canceled: boolean, filePath?: string }
  toggleSystemAudio: (options: { enabled: boolean }) => MediaSessionSnapshot
}>
