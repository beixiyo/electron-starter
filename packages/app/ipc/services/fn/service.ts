import type { BrowserWindow } from 'electron'
import type { FnContract, FnNativeEvent } from './contract'
import { createIpcService } from '@ipc/core'

export const fnService = createIpcService<FnContract>('fn', {})

export function sendFnRawEvent(window: BrowserWindow, event: FnNativeEvent): void {
  if (!window.isDestroyed())
    fnService.emit('raw', event, window)
}
