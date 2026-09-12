let originalOwnDescriptor: PropertyDescriptor | undefined
let overrideGetter: (() => boolean) | undefined
let overrideActive = false

/** 覆写当前 renderer 的在线状态，并在关闭时恢复原有实例属性。 */
export function applyForceOffline(offline: boolean): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false

  if (offline) {
    if (!overrideActive) {
      originalOwnDescriptor = Object.getOwnPropertyDescriptor(navigator, 'onLine')
      overrideGetter = () => false
      try {
        Object.defineProperty(navigator, 'onLine', {
          configurable: true,
          enumerable: originalOwnDescriptor?.enumerable ?? true,
          get: overrideGetter,
        })
      }
      catch (error) {
        originalOwnDescriptor = undefined
        overrideGetter = undefined
        console.warn('[mock] cannot override navigator.onLine', error)
        return false
      }
      overrideActive = true
    }

    window.dispatchEvent(new Event('offline'))
    return true
  }

  if (overrideActive) {
    try {
      const currentDescriptor = Object.getOwnPropertyDescriptor(navigator, 'onLine')
      const ownsOverride = currentDescriptor?.configurable === true
        && currentDescriptor.get === overrideGetter

      if (ownsOverride) {
        if (originalOwnDescriptor) Object.defineProperty(navigator, 'onLine', originalOwnDescriptor)
        else Reflect.deleteProperty(navigator, 'onLine')
      }
    }
    finally {
      originalOwnDescriptor = undefined
      overrideGetter = undefined
      overrideActive = false
    }
  }

  window.dispatchEvent(
    new Event(
      navigator.onLine
        ? 'online'
        : 'offline',
    ),
  )
  return true
}

/** HMR 或测试清理时恢复真实在线状态。 */
export function cleanupForceOffline(): void {
  if (overrideActive) applyForceOffline(false)
}
