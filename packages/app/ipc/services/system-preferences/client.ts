import { createServiceClient } from '@ipc/core'
import type { SystemPreferencesContract } from './contract'

export const systemPreferencesClient = createServiceClient<SystemPreferencesContract>('system-preferences', [
  'getHourCycle',
])
