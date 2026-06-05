import type { ShortcutBindings, ShortcutConfigContract } from './contract'
import { createIpcService } from '@ipc/core'
import { resumeFnShortcuts, suspendFnShortcuts } from '@main/fn-listener'
import { readShortcutBindings, writeShortcutBindings } from '@main/store/shortcut-bindings'

/**
 * @param onReapply 绑定更新后回调，由 main/index.ts 注入重新注册快捷键的逻辑
 */
export function createShortcutConfigService(
  onReapply: (bindings: ShortcutBindings) => void,
): void {
  createIpcService<ShortcutConfigContract>('shortcut-config', {
    async getBindings(_e) {
      return readShortcutBindings()
    },

    async setBindings(_e, bindings) {
      writeShortcutBindings(bindings)
      onReapply(bindings)
    },

    async pauseForRecord(_e) {
      suspendFnShortcuts()
    },

    async resumeAfterRecord(_e) {
      resumeFnShortcuts()
    },
  })
}
