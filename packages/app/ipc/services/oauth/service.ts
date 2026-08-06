import type { OAuthCallbackDelivery, OAuthCallbackParams } from '@shared'
import type { BrowserWindow, WebContents } from 'electron'
import type { OAuthContract } from './contract'
import { randomUUID } from 'node:crypto'
import { createIpcService } from '@ipc/core'
import { windowManager } from '@main/window-manager'
import { WindowType } from '@shared'

const pendingCallbacks: OAuthCallbackDelivery[] = []
let receiver: WebContents | null = null

export const oauthService = createIpcService<OAuthContract>('oauth', {
  registerReceiver: (event) => {
    receiver = getMainWindowSender(event)

    return [...pendingCallbacks]
  },
  acknowledgeCallback: (event, id) => {
    getMainWindowSender(event)
    const index = pendingCallbacks.findIndex(callback => callback.id === id)
    if (index >= 0)
      pendingCallbacks.splice(index, 1)
  },
  unregisterReceiver: (event) => {
    const sender = getMainWindowSender(event)
    if (receiver === sender)
      receiver = null
  },
})

/**
 * 将回调交给已就绪的登录页；监听器尚未挂载时按到达顺序保留回调
 * registerReceiver 只读取 pending，显式确认后才删除，避免 reload 或崩溃丢失回调
 */
export function sendOAuthCallback(window: BrowserWindow, params: OAuthCallbackParams): void {
  if (window.isDestroyed())
    return

  const delivery = {
    id: randomUUID(),
    params,
  }
  pendingCallbacks.push(delivery)

  if (receiver && !receiver.isDestroyed() && receiver.id === window.webContents.id) {
    oauthService.emit('callbackDelivery', delivery, window)
    return
  }

  receiver = null
}

/** 只允许当前主窗口注册、确认或注销 OAuth receiver */
function getMainWindowSender(event: unknown): WebContents {
  const sender = (event as { sender: WebContents }).sender
  const mainWindow = windowManager.get(WindowType.MAIN)

  if (!mainWindow || mainWindow.isDestroyed() || sender.id !== mainWindow.webContents.id)
    throw new Error('OAuth callback receiver must be the main window')

  return sender
}
