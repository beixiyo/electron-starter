/**
 * ASR（自动语音识别）API
 * 用于 Node.js 环境（Electron main process）
 */

import type { AsrResponse } from './AsrClient'
import { AsrClient } from './AsrClient'

let asrClient: AsrClient | null = null

/**
 * 执行音频识别
 * @param audioData - 音频数据（ArrayBuffer 或 Uint8Array）
 * @returns 识别结果
 */
export async function requestAsr(
  audioData: ArrayBuffer | Uint8Array,
): Promise<AsrResponse> {
  if (!asrClient) {
    asrClient = new AsrClient({
      appid: import.meta.env.MAIN_VITE_ASR_APPID || '',
      token: import.meta.env.MAIN_VITE_ASR_TOKEN || '',
      cluster: import.meta.env.MAIN_VITE_ASR_CLUSTER || '',
      format: 'wav',
      codec: 'raw',
      rate: 16000,
      segSize: 160000,
    })
  }

  return asrClient.requestAsr(audioData)
}

export function parseAsrResult(result: AsrResponse) {
  return result.results?.map(result => result.text).join('') || ''
}
