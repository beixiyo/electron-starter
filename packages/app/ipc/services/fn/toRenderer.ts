/** Fn 原生事件的 main → renderer 推送面 */

import { createMainToRendererEmitter } from '@ipc/core'
import type { BrowserWindow } from 'electron'
import type { FnContract, FnNativeEvent } from './contract'

export const fnToRenderer = createMainToRendererEmitter<FnContract>('fn')

export function sendFnRawEvent(window: BrowserWindow, event: FnNativeEvent): void {
  if (!window.isDestroyed()) fnToRenderer.emit('raw', event, window)
}
