import type { UpdateContract } from './contract'
import { createServiceClient } from '@ipc/core'

export const updateClient = createServiceClient<UpdateContract>('update', [
  'check',
  'download',
  'install',
  'getVersion',
])
