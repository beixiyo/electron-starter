import { createServiceClient } from '@ipc/core'
import type { GlobalToastContract } from './contract'
import { GLOBAL_TOAST_NAMESPACE } from './contract'

/** renderer 使用的全局提示客户端 */
export const globalToastClient = createServiceClient<GlobalToastContract>(GLOBAL_TOAST_NAMESPACE, [
  'getCurrent',
])
