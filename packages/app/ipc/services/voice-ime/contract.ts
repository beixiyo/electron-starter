import type { IpcContract } from '@ipc/core'
import type { VoiceImeRendererStatusPayload } from '@shared'

export type VoiceImeContract = IpcContract<{}, {
  status: VoiceImeRendererStatusPayload
  /** 主进程请求中断并释放本次语音输入 */
  cancel: VoiceImeCancelPayload
}>

export type VoiceImeCancelPayload = {
  /** 中断来源 */
  reason: 'suspend' | 'resume' | 'lock-screen' | 'unlock-screen'
}
