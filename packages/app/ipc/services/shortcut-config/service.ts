import type { IpcMainInvokeEvent } from 'electron'
import type { ShortcutBindings, ShortcutConfigContract } from './contract'
import { createIpcService } from '@ipc/core'
import {
  filterPersistableShortcutBindings,
  getElectronShortcutCapabilities,
  resumeFnShortcuts,
  startRecordShortcutDetection,
  stopRecordShortcutDetection,
  suspendFnShortcuts,
} from '@main/shortcuts'
import { readShortcutBindings, writeShortcutBindings } from '@main/store/shortcut-bindings'
import { normalizeShortcutBindings, resolveShortcutBindingConflicts } from '@shared/shortcuts'
import { BrowserWindow } from 'electron'

/**
 * @param onReapply 绑定更新后回调，由 main/index.ts 注入重新注册快捷键的逻辑
 */
export function createShortcutConfigService(
  onReapply: (bindings: ShortcutBindings) => void,
): void {
  const service = createIpcService<ShortcutConfigContract>('shortcut-config', {
    mainHandle: {
      async getBindings(_e) {
        return filterPersistableShortcutBindings(readShortcutBindings())
      },

      async setBindings(_e, bindings) {
        const nextBindings = filterPersistableShortcutBindings(
          resolveShortcutBindingConflicts(normalizeShortcutBindings(bindings)),
        )
        writeShortcutBindings(nextBindings)
        onReapply(nextBindings)
      },

      async getCapabilities(_e) {
        return getElectronShortcutCapabilities()
      },

      async pauseForRecord(e) {
        suspendFnShortcuts()
        const win = BrowserWindow.fromWebContents((e as IpcMainInvokeEvent).sender)
        try {
          startRecordShortcutDetection((recordEvent) => {
            service.emit('record', recordEvent, win ?? undefined)
          })
        }
        catch (error) {
          resumeFnShortcuts()
          throw error
        }
      },

      async resumeAfterRecord(_e) {
        stopRecordShortcutDetection()
        resumeFnShortcuts()
      },
    },
  })
}
