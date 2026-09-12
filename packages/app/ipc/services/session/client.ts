import { createServiceClient } from '@ipc/core'
import type { SessionContract } from './contract'

export const sessionClient = createServiceClient<SessionContract>('session', [
  'clearHttpCache',
])
