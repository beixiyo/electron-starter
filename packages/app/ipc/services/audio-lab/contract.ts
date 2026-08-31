import type { AudioLabSettings, AudioLabSettingsPatch } from '@shared'
import type { IpcContract } from '@ipc/core'

/** 音频实验场 IPC：读取并更新下一场 native 录音使用的明确设置。 */
export type AudioLabContract = IpcContract<{
  mainHandle: {
    getSettings: () => AudioLabSettings
    updateSettings: (patch: AudioLabSettingsPatch) => AudioLabSettings
  }
}>
