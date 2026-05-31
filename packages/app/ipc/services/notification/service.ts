import type { NativeCloseReason, NativeNotifyPayload, NotificationContract } from './contract'
import { createIpcService } from '@ipc/core'
import { BrowserWindow, Notification } from 'electron'

/** 存活中的通知实例，用于按 id 关闭与清理 */
const alive = new Map<string, Notification>()

export const notificationService = createIpcService<NotificationContract>('notification', {
  async isSupported() {
    return Notification.isSupported()
  },

  async show(event, payload: NativeNotifyPayload) {
    const { id } = payload

    /** 事件只回传给发起的窗口，避免广播到所有窗口 */
    const owner = BrowserWindow.fromWebContents(
      (event as Electron.IpcMainInvokeEvent).sender,
    ) ?? undefined

    const notification = new Notification({
      /**
       * 有 tag 用 tag 作为系统 id（相同 tag 替换/去重已投递通知），
       * 无 tag 用每次唯一的 payload.id 兜底（避免 Electron 赋随机 UUID，且互不替换）
       */
      id: payload.tag ?? payload.id,
      /** groupId 仅做通知中心的视觉分组 */
      groupId: payload.tag,
      title: payload.title,
      body: payload.body,
      icon: payload.icon,
      silent: payload.silent,
      subtitle: payload.subtitle,
      urgency: payload.urgency,
      timeoutType: payload.requireInteraction
        ? 'never'
        : payload.timeoutType,
      sound: payload.sound,
      closeButtonText: payload.closeButtonText,
      hasReply: payload.hasReply,
      replyPlaceholder: payload.replyPlaceholder,
      actions: payload.actions?.map(action => ({ type: 'button', text: action.text })),
    })

    alive.set(id, notification)

    notification.on('show', () => notificationService.emit('event', { id, type: 'show' }, owner))
    notification.on('click', () => notificationService.emit('event', { id, type: 'click' }, owner))
    notification.on('action', (_e, actionIndex) => notificationService.emit('event', { id, type: 'action', actionIndex }, owner))
    notification.on('reply', (_e, reply) => notificationService.emit('event', { id, type: 'reply', reply }, owner))

    notification.on('failed', (_e, error) => {
      notificationService.emit('event', { id, type: 'failed', error: String(error) }, owner)
      alive.delete(id)
    })
    notification.on('close', (e: Electron.Event & { reason?: NativeCloseReason }) => {
      notificationService.emit('event', { id, type: 'close', reason: e.reason }, owner)
      alive.delete(id)
    })

    notification.show()
  },

  async close(_event, id: string) {
    alive.get(id)?.close()
    alive.delete(id)
  },
})
