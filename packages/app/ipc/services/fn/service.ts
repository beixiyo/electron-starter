import type { BrowserWindow } from 'electron'
import type { FnContract } from './contract'
import { createIpcService } from '@ipc/core'

export const fnService = createIpcService<FnContract>('fn', {})

export function sendFnDownEvent(window: BrowserWindow): void {
  if (window && !window.isDestroyed())
    fnService.emit('down', undefined, window)
}

export function sendFnUpEvent(window: BrowserWindow): void {
  if (window && !window.isDestroyed())
    fnService.emit('up', undefined, window)
}

export function sendFnDoublePressEvent(window: BrowserWindow): void {
  if (window && !window.isDestroyed())
    fnService.emit('doublePress', undefined, window)
}
