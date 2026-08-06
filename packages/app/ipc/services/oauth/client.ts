import type { OAuthContract } from './contract'
import { createServiceClient } from '@ipc/core'

export const oauthClient = createServiceClient<OAuthContract>('oauth', [
  'registerReceiver',
  'acknowledgeCallback',
  'unregisterReceiver',
])
