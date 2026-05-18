import type { ShortcutTestPayload } from '@shared'
import { SHORTCUT_TEST_CHANNEL } from '@shared'
import { ipcRenderer } from 'electron'

export const shortcutTestApi = {
  onTrigger(callback: (payload: ShortcutTestPayload) => void) {
    const handler = (_: unknown, payload: ShortcutTestPayload) => {
      callback(payload)
    }
    ipcRenderer.on(SHORTCUT_TEST_CHANNEL.TRIGGER, handler)
    return () => {
      ipcRenderer.removeListener(SHORTCUT_TEST_CHANNEL.TRIGGER, handler)
    }
  },
}
