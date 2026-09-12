import { createServiceClient } from '@ipc/core'
import type { PowerContract } from './contract'

export const powerClient = createServiceClient<PowerContract>('power', [
  'startActivity',
  'stopActivity',
])
