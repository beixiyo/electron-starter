import type { IpcContract } from '@ipc/core'
import type { LogicalWindowRoute, PoolWindowType } from '@shared'

export type LogicalWindowContract = IpcContract<{
  getCurrentRoute: (poolType: PoolWindowType) => LogicalWindowRoute | null
}, {
  route: LogicalWindowRoute
  clear: { poolType: PoolWindowType, token: number }
}>
