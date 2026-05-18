import type { VoiceImeRendererStatusPayload } from '@shared'
import { windowApi } from '@ipc/services/window/api'
import { VOICE_IME_RENDERER_CHANNEL, WindowType } from '@shared'
import { ipcRenderer } from 'electron'

export const voiceImeApi = {
  show() {
    return windowApi.show(WindowType.VOICE_IME)
  },

  hide() {
    return windowApi.hide(WindowType.VOICE_IME)
  },

  toggle() {
    return windowApi.toggle(WindowType.VOICE_IME)
  },

  isVisible() {
    return windowApi.isVisible(WindowType.VOICE_IME)
  },

  onStatusChange(callback: (payload: VoiceImeRendererStatusPayload) => void) {
    const handler = (_: unknown, payload: VoiceImeRendererStatusPayload) => {
      callback(payload)
    }
    ipcRenderer.on(VOICE_IME_RENDERER_CHANNEL.STATUS, handler)
    return () => {
      ipcRenderer.removeListener(VOICE_IME_RENDERER_CHANNEL.STATUS, handler)
    }
  },
}
