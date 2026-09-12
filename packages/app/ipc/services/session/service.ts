/** Chromium session 治理服务。 */

import { createIpcService } from '@ipc/core'
import { session } from 'electron'
import type { SessionContract } from './contract'

export const sessionService = createIpcService<SessionContract>('session', {
  mainHandle: {
    async clearHttpCache() {
      await session.defaultSession.clearCache()
    },
  },
})
