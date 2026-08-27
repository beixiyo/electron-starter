import { createMainToRendererEmitter } from '@ipc/core'
import type { GlobalToastContract } from './contract'
import { GLOBAL_TOAST_NAMESPACE } from './contract'

/** 主进程定向向提示窗口推送当前内容 */
export const globalToastToRenderer = createMainToRendererEmitter<GlobalToastContract>(GLOBAL_TOAST_NAMESPACE)
