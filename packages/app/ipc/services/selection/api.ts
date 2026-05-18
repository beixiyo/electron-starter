import type { selectionHandlers } from './handlers'
import { createIpcClient } from '@ipc/core'

type SelectionHandlers = typeof selectionHandlers

/**
 * 创建 Selection IPC 客户端
 */
export const selectionApi = createIpcClient<SelectionHandlers>({
  namespace: 'selection',
  methods: [
    'showSelectionWindow',
    'closeSelectionWindow',
  ],
})
