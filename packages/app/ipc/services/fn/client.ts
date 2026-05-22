import type { FnContract } from './contract'
import { createServiceClient } from '@ipc/core'

export const fnClient = createServiceClient<FnContract>('fn', [])
