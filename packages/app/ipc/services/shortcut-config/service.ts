import type { IpcMainInvokeEvent } from 'electron'
import type { ShortcutBindings, ShortcutConfigContract } from './contract'
import { createIpcService } from '@ipc/core'
import { resumeFnShortcuts, startRecordShortcutDetection, stopRecordShortcutDetection, suspendFnShortcuts } from '@main/keyboard'
import { readShortcutBindings, writeShortcutBindings } from '@main/store/shortcut-bindings'
import { BrowserWindow } from 'electron'

/**
 * @param onReapply 绑定更新后回调，由 main/index.ts 注入重新注册快捷键的逻辑
 */
export function createShortcutConfigService(
  onReapply: (bindings: ShortcutBindings) => void,
): void {
  const service = createIpcService<ShortcutConfigContract>('shortcut-config', {
    async getBindings(_e) {
      return readShortcutBindings()
    },

    async setBindings(_e, bindings) {
      writeShortcutBindings(bindings)
      onReapply(bindings)
    },

    async pauseForRecord(e) {
      suspendFnShortcuts()
      const win = BrowserWindow.fromWebContents((e as IpcMainInvokeEvent).sender)
      startRecordShortcutDetection((recordEvent) => {
        service.emit('record', recordEvent, win ?? undefined)
      })
    },

    async resumeAfterRecord(_e) {
      stopRecordShortcutDetection()
      resumeFnShortcuts()
    },
  })
}
