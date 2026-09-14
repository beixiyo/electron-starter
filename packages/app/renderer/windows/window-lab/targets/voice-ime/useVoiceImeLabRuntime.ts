/** 把 Voice IME 的 viewport runtime 适配到 Window Lab 的 iframe 或原生预览。 */

import type { VoiceImeViewportRuntime } from '@/windows/voice-ime/VoiceImeApp/hooks'
import { useConst, useLatestCallback } from 'hooks'
import { getWindowLabApi } from '../../ipc'
import type { WindowLabSizeMessage } from '../../types'

export function useVoiceImeLabRuntime(): VoiceImeViewportRuntime {
  const resizeTo = useLatestCallback(async (width: number, height: number, animate: boolean) => {
    if (window.parent === window) {
      const api = getWindowLabApi()
      if (!api?.resizeSelf) return
      const result = await Promise.resolve(api.resizeSelf(width, height, animate))
      if (!result.success) console.warn(`[window-lab] resize rejected: ${result.error ?? 'unknown error'}`)
      return
    }

    const message: WindowLabSizeMessage = {
      type: 'window-lab:size',
      target: 'voice-ime',
      width,
      height,
    }
    window.parent.postMessage(message, window.location.origin)
  })

  const hide = useLatestCallback(() => {})
  return useConst<VoiceImeViewportRuntime>({ resizeTo, hide })
}
