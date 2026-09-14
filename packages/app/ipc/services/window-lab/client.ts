import { createServiceClient } from '@ipc/core'
import type { WindowLabContract } from './contract'
import { WINDOW_LAB_NAMESPACE } from './contract'

/** Window Lab 的 renderer/preload 客户端。 */
export const windowLabClient = createServiceClient<WindowLabContract>(WINDOW_LAB_NAMESPACE, [
  'openControl',
  'openPreview',
  'closePreview',
  'getPreview',
  'resizeSelf',
  'getSelfBounds',
])
