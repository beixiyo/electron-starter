import type { FocusDemoPayload } from '@shared'
import { FOCUS_DEMO_CHANNEL } from '@shared'
import { ipcRenderer } from 'electron'

export const focusDemoApi = {
  onUpdate(callback: (payload: FocusDemoPayload) => void) {
    const handler = (_: unknown, payload: FocusDemoPayload) => {
      callback(payload)
    }
    ipcRenderer.on(FOCUS_DEMO_CHANNEL.UPDATE, handler)
    return () => {
      ipcRenderer.removeListener(FOCUS_DEMO_CHANNEL.UPDATE, handler)
    }
  },
}
