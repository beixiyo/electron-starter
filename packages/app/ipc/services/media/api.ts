import type { mediaHandlers } from './handlers'
import { createIpcClient } from '@ipc/core'

type MediaHandlers = typeof mediaHandlers

/**
 * 创建 Media IPC 客户端
 */
export const mediaApi = createIpcClient<MediaHandlers>({
  namespace: 'media',
  methods: ['getSources', 'saveBuffer', 'toggleSystemAudio'],
})
