import { createServiceClient } from '@ipc/core'
import type { ClientEnvContract } from './contract'

export const clientEnvClient = createServiceClient<ClientEnvContract>('client-env', [
  'getPlatform',
  'getSnapshot',
])
