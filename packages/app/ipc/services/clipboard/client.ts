import { createServiceClient } from '@ipc/core'
import type { ClipboardContract } from './contract'
import { CLIPBOARD_NAMESPACE } from './contract'

export const clipboardClient = createServiceClient<ClipboardContract>(CLIPBOARD_NAMESPACE, [
  'writeText',
])
