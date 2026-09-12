import { createServiceClient } from '@ipc/core'
import type { NavigationContract } from './contract'

export const navigationClient = createServiceClient<NavigationContract>('navigation', [
  'openMainRoute',
  'takePendingRoute',
])
