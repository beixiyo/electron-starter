import type { NotifyEventCtx, NotifyHandle, NotifyOptions } from './types'

/**
 * Web 适配器
 *
 * 基于浏览器原生 `Notification`。注意：
 * - 操作按钮（`actions`）与内联回复仅在桌面端可用，这里直接忽略
 * - 展示前需要通知权限，未授权时自动申请；被拒绝则走 `onError`
 */

/** 非标准但被部分浏览器支持的字段，单独扩展以保持严格类型 */
type WebNotificationInit = NotificationOptions & {
  image?: string
  vibrate?: number | number[]
  renotify?: boolean
}

export function webNotify(options: NotifyOptions): NotifyHandle {
  const ctx: NotifyEventCtx = { tag: options.tag, data: options.data }

  if (typeof window === 'undefined' || !('Notification' in window)) {
    options.onError?.(ctx)
    return { close: () => {} }
  }

  let instance: Notification | null = null

  const create = (): void => {
    const init: WebNotificationInit = {
      body: options.body,
      icon: options.icon,
      silent: options.silent,
      tag: options.tag,
      requireInteraction: options.requireInteraction,
      data: options.data,

      badge: options.web?.badge,
      image: options.web?.image,
      dir: options.web?.dir,
      lang: options.web?.lang,
      renotify: options.web?.renotify,
      vibrate: options.web?.vibrate,
    }

    instance = new Notification(options.title, init)
    instance.onshow = () => options.onShow?.(ctx)
    instance.onclick = () => options.onClick?.(ctx)
    instance.onclose = () => options.onClose?.(ctx)
    instance.onerror = () => options.onError?.(ctx)
  }

  if (Notification.permission === 'granted') {
    create()
  }
  else if (Notification.permission === 'denied') {
    options.onError?.(ctx)
  }
  else {
    Notification.requestPermission().then((permission) => {
      if (permission === 'granted')
        create()
      else
        options.onError?.(ctx)
    })
  }

  return {
    close: () => instance?.close(),
  }
}

export function webNotifySupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

export async function requestWebPermission(): Promise<boolean> {
  if (!webNotifySupported())
    return false
  if (Notification.permission === 'granted')
    return true
  if (Notification.permission === 'denied')
    return false

  const permission = await Notification.requestPermission()
  return permission === 'granted'
}
