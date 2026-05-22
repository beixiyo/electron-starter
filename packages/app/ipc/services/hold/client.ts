import type { HoldContract } from './contract'
import { createServiceClient } from '@ipc/core'

export const holdClient = createServiceClient<HoldContract>('hold', [])
