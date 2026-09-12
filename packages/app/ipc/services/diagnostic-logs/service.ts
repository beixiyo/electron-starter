/** 仅从应用管理的日志根目录生成诊断附件 */
import { createIpcService } from '@ipc/core'
import { windowManager } from '@main/window-manager'
import { WindowType } from '@shared'
import { getDiagnosticLogRootDir } from '@main/logging'
import { collectDiagnosticLogs } from './collector'
import type { DiagnosticLogsContract } from './contract'

export const diagnosticLogsService = createIpcService<DiagnosticLogsContract>('diagnostic-logs', {
  mainHandle: {
    async collect(event, payload) {
      const mainWindow = windowManager.get(WindowType.MAIN)
      if (!mainWindow || mainWindow.isDestroyed() || (event as Electron.IpcMainInvokeEvent).sender.id !== mainWindow.webContents.id)
        throw new Error('Diagnostic logs must be collected by the main window')

      const now = Date.now()
      return collectDiagnosticLogs({
        rootDir: getDiagnosticLogRootDir(),
        range: payload ?? { startAt: new Date(now - 24 * 60 * 60 * 1000).toISOString(), endAt: new Date(now).toISOString() },
      })
    },
  },
})
