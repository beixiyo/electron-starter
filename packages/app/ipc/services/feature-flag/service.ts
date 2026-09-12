/** 接收主窗口的远端开关；主进程与 IPC 读取共用唯一状态源。 */
import type { FeatureFlagContract } from './contract'
import { createIpcService } from '@ipc/core/service'
import { getFeatureFlagSnapshot, setFeatureFlags } from '@main/feature-flags'
import { windowManager } from '@main/window-manager'
import { WindowType } from '@shared'

export const featureFlagService = createIpcService<FeatureFlagContract>('feature-flag', {
  mainHandle: {
    sync(event, flags) {
      const mainWindow = windowManager.get(WindowType.MAIN)
      if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.id !== (event as Electron.IpcMainInvokeEvent).sender.id)
        throw new Error('Feature flags must be synchronized by the main window')
      if (!flags || typeof flags !== 'object' || Array.isArray(flags)
        || Object.values(flags).some(value => typeof value !== 'boolean'))
        throw new Error('Invalid feature flag snapshot')
      setFeatureFlags(flags)
      return { success: true }
    },
    getState: getFeatureFlagSnapshot,
  },
})
