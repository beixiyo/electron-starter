import { electronAPI } from '@electron-toolkit/preload'
import { fnClient } from '@ipc/services/fn/client'
import { focusDemoClient } from '@ipc/services/focus-demo/client'
import { holdClient } from '@ipc/services/hold/client'
import { mediaClient } from '@ipc/services/media/client'
import { meetingDetectionClient } from '@ipc/services/meeting-detection/client'
import { notificationClient } from '@ipc/services/notification/client'
import { oauthClient } from '@ipc/services/oauth/client'
import { permissionClient } from '@ipc/services/permission/client'
import { screenshotClient } from '@ipc/services/screenshot/client'
import { selectionClient } from '@ipc/services/selection/client'
import { shortcutConfigClient } from '@ipc/services/shortcut-config/client'
import { shortcutTestClient } from '@ipc/services/shortcut-test/client'
import { voiceImeClient } from '@ipc/services/voice-ime/client'
import { windowClient } from '@ipc/services/window/client'
import { contextBridge } from 'electron'

export const ipc = {
  media: mediaClient,
  window: windowClient,
  focusDemo: focusDemoClient,
  hold: holdClient,
  voiceIme: voiceImeClient,
  selection: selectionClient,
  shortcutConfig: shortcutConfigClient,
  shortcutTest: shortcutTestClient,
  oauth: oauthClient,
  permission: permissionClient,
  fn: fnClient,
  screenshot: screenshotClient,
  meetingDetection: meetingDetectionClient,
  notification: notificationClient,
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
