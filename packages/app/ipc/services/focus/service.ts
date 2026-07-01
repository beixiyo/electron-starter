import type { FocusContract } from './contract'
import { createIpcService } from '@ipc/core'

export const focusService = createIpcService<FocusContract>('focus', {})
