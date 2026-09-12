/** 系统剪贴板的主进程实现。 */

import { createIpcService } from '@ipc/core'
import { clipboard } from 'electron'
import type { ClipboardContract } from './contract'
import { CLIPBOARD_NAMESPACE } from './contract'

createIpcService<ClipboardContract>(CLIPBOARD_NAMESPACE, {
  mainHandle: {
    async writeText(_event, text) {
      clipboard.writeText(text)
    },
  },
})
