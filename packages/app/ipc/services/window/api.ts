import type { windowHandlers } from './handlers'
import { createIpcClient } from '@ipc/core'

type WindowHandlers = typeof windowHandlers

/**
 * 创建 Window IPC 客户端
 */
export const windowApi = createIpcClient<WindowHandlers>({
  namespace: 'window',
  methods: [
    'create',
    'show',
    'hide',
    'toggle',
    'destroy',
    'isVisible',
    'exists',
    'getMetadata',
    'getAllTypes',
    'release',
    'isHolding',
    'getState',
    'resizeTo',
  ],
})
