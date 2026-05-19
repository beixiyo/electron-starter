import { electronAPI } from '@electron-toolkit/preload'
import { fnApi } from '@ipc/listeners/fn/api'
import { holdApi } from '@ipc/listeners/hold/api'
import { oauthApi } from '@ipc/listeners/oauth/api'
import { screenshotApi } from '@ipc/listeners/screenshot/api'
import { selectionApi } from '@ipc/listeners/selection/api'
import { shortcutTestApi } from '@ipc/listeners/shortcut-test/api'
import { voiceImeApi } from '@ipc/listeners/voice-ime/api'
import { mediaApi } from '@ipc/services/media/api'
import { windowApi } from '@ipc/services/window/api'
import { contextBridge } from 'electron'

export const ipc = {
  media: mediaApi,
  window: windowApi,
  hold: holdApi,
  voiceIme: voiceImeApi,
  selection: selectionApi,
  shortcutTest: shortcutTestApi,
  oauth: oauthApi,
  fn: fnApi,
  screenshot: screenshotApi,
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('$electron', electronAPI)
    contextBridge.exposeInMainWorld('$ipc', ipc)
  }
  catch (error) {
    console.error(error)
  }
}
else {
  // @ts-ignore (define in dts)
  window.$electron = electronAPI
  // @ts-ignore (define in dts)
  window.$ipc = ipc
}

export type Ipc = typeof ipc
