import type { ShortcutConfigContract } from './contract'
import { createServiceClient } from '@ipc/core'

export const shortcutConfigClient = createServiceClient<ShortcutConfigContract>(
  'shortcut-config',
  ['getBindings', 'setBindings', 'pauseForRecord', 'resumeAfterRecord'],
)
