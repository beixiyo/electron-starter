import type { ShortcutTestContract } from './contract'
import { createServiceClient } from '@ipc/core'

export const shortcutTestClient = createServiceClient<ShortcutTestContract>('shortcut-test', [])
