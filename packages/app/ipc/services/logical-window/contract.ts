import type { IpcContract } from '@ipc/core'
import type { LogicalWindowRoute, PoolWindowType } from '@shared'

export type LogicalWindowContract = IpcContract<{
  mainHandle: {
    getCurrentRoute: (poolType: PoolWindowType) => LogicalWindowRoute | null
  }
  rendererOn: {
    route: LogicalWindowRoute
    clear: { poolType: PoolWindowType, token: number }
  }
}>
