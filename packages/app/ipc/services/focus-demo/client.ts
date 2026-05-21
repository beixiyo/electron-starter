import type { FocusDemoContract } from './contract'
import { createServiceClient } from '@ipc/core'

export const focusDemoClient = createServiceClient<FocusDemoContract>('focus-demo', [])
