import type { PermissionContract } from './contract'
import { createServiceClient } from '@ipc/core'

export const permissionClient = createServiceClient<PermissionContract>('permission', [
  'get',
  'request',
  'openSettings',
  'getDragGuideState',
  'dragGuideDrag',
  'dragGuideDismiss',
])
