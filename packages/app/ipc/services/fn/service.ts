import type { BrowserWindow } from 'electron'
import type { FnComboKey, FnContract, Modifier } from './contract'
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

export function sendFnComboEvent(
  window: BrowserWindow,
  key: FnComboKey,
  modifiers: Modifier[] = [],
): void {
  if (window && !window.isDestroyed())
    fnService.emit('combo', { key, modifiers }, window)
}
