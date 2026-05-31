import type { NotificationContract } from './contract'
import { createServiceClient } from '@ipc/core'

export const notificationClient = createServiceClient<NotificationContract>('notification', [
  'isSupported',
  'show',
  'close',
])
