import type { LogRecordPayload } from '@jl-org/log'
import { electronAPI } from '@electron-toolkit/preload'
import { fnClient } from '@ipc/services/fn/client'
import { focusClient } from '@ipc/services/focus/client'
import { holdClient } from '@ipc/services/hold/client'
import { logicalWindowClient } from '@ipc/services/logical-window/client'
import { mediaClient } from '@ipc/services/media/client'
import { meetingDetectionClient } from '@ipc/services/meeting-detection/client'
import { notificationClient } from '@ipc/services/notification/client'
import { oauthClient } from '@ipc/services/oauth/client'
import { permissionClient } from '@ipc/services/permission/client'
import { recordingClient } from '@ipc/services/recording/client'
import { screenshotClient } from '@ipc/services/screenshot/client'
import { selectionClient } from '@ipc/services/selection/client'
import { shortcutConfigClient } from '@ipc/services/shortcut-config/client'
import { updateClient } from '@ipc/services/update/client'
import { voiceImeClient } from '@ipc/services/voice-ime/client'
import { windowClient } from '@ipc/services/window/client'
import { exposeLogBridge, JL_LOG_BRIDGE_KEY, JL_LOG_IPC_CHANNEL } from '@jl-org/log'
import { contextBridge, ipcRenderer } from 'electron'

export const ipc = {
  media: mediaClient,
  window: windowClient,
  focus: focusClient,
  hold: holdClient,
  logicalWindow: logicalWindowClient,
  voiceIme: voiceImeClient,
  selection: selectionClient,
  shortcutConfig: shortcutConfigClient,
  oauth: oauthClient,
  permission: permissionClient,
  recording: recordingClient,
  fn: fnClient,
  screenshot: screenshotClient,
  meetingDetection: meetingDetectionClient,
  notification: notificationClient,
  update: updateClient,
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('$electron', electronAPI)
    contextBridge.exposeInMainWorld('$ipc', ipc)
    exposeLogBridge(contextBridge, ipcRenderer)
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
  // @ts-ignore (define in dts)
  window[JL_LOG_BRIDGE_KEY] = {
    send: (record: LogRecordPayload) => ipcRenderer.send(JL_LOG_IPC_CHANNEL, record),
  }
}

export type Ipc = typeof ipc
