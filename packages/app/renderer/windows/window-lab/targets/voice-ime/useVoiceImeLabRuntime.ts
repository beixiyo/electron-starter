/** 把 Voice IME 的 viewport runtime 适配到 Window Lab 的 iframe 或原生预览。 */

import type { VoiceImeViewportRuntime } from '@/windows/voice-ime/VoiceImeApp/hooks'
import { useConst } from 'hooks'

/**
 * 预览宿主什么都不用做：窗口尺寸固定（shared 的 `VOICE_IME_SIZE`），形变全在壳里；
 * 壳的度量上报是给生产浮层摆全局提示条用的，预览没有提示条，也不能碰生产 IPC
 */
const NOOP = () => {}

export function useVoiceImeLabRuntime(): VoiceImeViewportRuntime {
  return useConst<VoiceImeViewportRuntime>({ reportShell: NOOP, hide: NOOP, onHidden: () => NOOP })
}
