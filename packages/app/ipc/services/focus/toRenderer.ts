/** 文本焦点状态的 main → renderer 推送面 */

import { createMainToRendererEmitter } from '@ipc/core'
import type { FocusContract } from './contract'

export const focusToRenderer = createMainToRendererEmitter<FocusContract>('focus')
