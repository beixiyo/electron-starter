import type { FocusContract } from './contract'
import { createServiceClient } from '@ipc/core'

export const focusClient = createServiceClient<FocusContract>('focus', [])
