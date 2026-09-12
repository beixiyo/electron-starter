/** 把全局 Escape 消费者的生命周期绑定到窗口可见性 */

import type { WindowType } from '@shared'
import { type GlobalEscapeConsumer, registerGlobalEscapeConsumer } from './global-escape'
import { windowManager } from './window-manager'

/**
 * 窗口显示时登记消费者，隐藏或销毁时注销消费者
 *
 * 窗口管理器的订阅不会回放当前状态，因此绑定时额外检查一次已有窗口；
 * 这样装配发生在窗口创建之后也不会漏掉当前可见窗口
 *
 * @returns 同时解除可见性监听并注销消费者的幂等函数
 */
export function bindGlobalEscapeConsumerToVisibility(
  type: WindowType,
  consumer: GlobalEscapeConsumer,
): () => void {
  let unregister: (() => void) | null = null

  const update = (visible: boolean): void => {
    if (visible) {
      unregister ??= registerGlobalEscapeConsumer(consumer)
      return
    }

    unregister?.()
    unregister = null
  }

  const unsubscribe = windowManager.onVisibilityChange(type, update)
  if (windowManager.isVisible(type)) update(true)

  let cleaned = false
  return () => {
    if (cleaned) return
    cleaned = true
    unsubscribe()
    update(false)
  }
}
