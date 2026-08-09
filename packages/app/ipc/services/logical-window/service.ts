import type { LogicalWindowContract } from './contract'
import { createIpcService } from '@ipc/core'
import { getCurrentLogicalWindowRoute } from '@main/window-manager/logical-window-state'

export const logicalWindowService = createIpcService<LogicalWindowContract>('logical-window', {
  mainHandle: {
    getCurrentRoute: async (_event, poolType) => {
      return getCurrentLogicalWindowRoute(poolType)
    },
  },
})
