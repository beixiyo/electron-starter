import type { ShortcutTestContract } from './contract'
import { createIpcService } from '@ipc/core'

export const shortcutTestService = createIpcService<ShortcutTestContract>('shortcut-test', {})
