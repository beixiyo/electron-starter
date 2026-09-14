import { electronAPI } from '@electron-toolkit/preload'
import { audioLabClient } from '@ipc/services/audio-lab/client'
import { clientEnvClient } from '@ipc/services/client-env/client'
import { clipboardClient } from '@ipc/services/clipboard/client'
import { diagnosticLogsClient } from '@ipc/services/diagnostic-logs/client'
import { featureFlagClient } from '@ipc/services/feature-flag/client'
import { focusClient } from '@ipc/services/focus/client'
import { globalToastClient } from '@ipc/services/global-toast/client'
import { logicalWindowClient } from '@ipc/services/logical-window/client'
import { mediaClient } from '@ipc/services/media/client'
import { meetingDetectionClient } from '@ipc/services/meeting-detection/client'
import { navigationClient } from '@ipc/services/navigation/client'
import { notificationClient } from '@ipc/services/notification/client'
import { oauthClient } from '@ipc/services/oauth/client'
import { permissionClient } from '@ipc/services/permission/client'
import { powerClient } from '@ipc/services/power/client'
import { recordingClient } from '@ipc/services/recording/client'
import { screenshotClient } from '@ipc/services/screenshot/client'
import { selectionClient } from '@ipc/services/selection/client'
import { sessionClient } from '@ipc/services/session/client'
import { shortcutConfigClient } from '@ipc/services/shortcut-config/client'
import { systemPreferencesClient } from '@ipc/services/system-preferences/client'
import { updateClient } from '@ipc/services/update/client'
import { voiceImeClient } from '@ipc/services/voice-ime/client'
import { windowLabClient } from '@ipc/services/window-lab/client'
import { windowClient } from '@ipc/services/window/client'
import type { LogRecordPayload } from '@jl-org/log'
import { exposeLogBridge, JL_LOG_BRIDGE_KEY, JL_LOG_IPC_CHANNEL } from '@jl-org/log'
import { contextBridge, ipcRenderer } from 'electron'

export const ipc = {
  featureFlag: featureFlagClient,
  diagnosticLogs: diagnosticLogsClient,
  clipboard: clipboardClient,
  clientEnv: clientEnvClient,
  power: powerClient,
  session: sessionClient,
  navigation: navigationClient,

  audioLab: audioLabClient,
  media: mediaClient,
  window: windowClient,
  windowLab: windowLabClient,
  focus: focusClient,
  globalToast: globalToastClient,
  logicalWindow: logicalWindowClient,
  voiceIme: voiceImeClient,
  selection: selectionClient,
  shortcutConfig: shortcutConfigClient,
  oauth: oauthClient,
  permission: permissionClient,
  recording: recordingClient,
  screenshot: screenshotClient,
  meetingDetection: meetingDetectionClient,
  notification: notificationClient,
  update: updateClient,
  systemPreferences: systemPreferencesClient,
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
