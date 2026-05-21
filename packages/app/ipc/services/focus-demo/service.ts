import type { FocusDemoContract } from './contract'
import { createIpcService } from '@ipc/core'

export const focusDemoService = createIpcService<FocusDemoContract>('focus-demo', {})
