import type { LogicalWindowContract } from './contract'
import { createServiceClient } from '@ipc/core'

export const logicalWindowClient = createServiceClient<LogicalWindowContract>('logical-window', [
  'getCurrentRoute',
])
