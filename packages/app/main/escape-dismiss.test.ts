/** 窗口可见性与全局 Escape 消费者生命周期的行为测试 */

import type { WindowType } from '@shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  visible: false,
  listener: null as null | ((visible: boolean) => void),
  unsubscribe: vi.fn(),
  unregister: vi.fn(),
  register: vi.fn(() => harness.unregister),
  onVisibilityChange: vi.fn((_type: WindowType, listener: (visible: boolean) => void) => {
    harness.listener = listener
    return harness.unsubscribe
  }),
  isVisible: vi.fn(() => harness.visible),
}))

vi.mock('./global-escape', () => ({
  registerGlobalEscapeConsumer: harness.register,
}))

vi.mock('./window-manager', () => ({
  windowManager: {
    onVisibilityChange: harness.onVisibilityChange,
    isVisible: harness.isVisible,
  },
}))

const { bindGlobalEscapeConsumerToVisibility } = await import('./escape-dismiss')

describe('全局 Escape 可见性绑定', () => {
  beforeEach(() => {
    harness.visible = false
    harness.listener = null
    harness.unsubscribe.mockClear()
    harness.unregister.mockClear()
    harness.register.mockClear()
    harness.onVisibilityChange.mockClear()
    harness.isVisible.mockClear()
  })

  it('可见时只登记一次，隐藏后注销，重复状态通知不重复操作', () => {
    const consumer = { id: 'surface', priority: 1, onEscape: vi.fn() }
    const cleanup = bindGlobalEscapeConsumerToVisibility('voice-ime' as WindowType, consumer)

    expect(harness.register).not.toHaveBeenCalled()

    harness.listener?.(true)
    harness.listener?.(true)
    expect(harness.register).toHaveBeenCalledOnce()

    harness.listener?.(false)
    harness.listener?.(false)
    expect(harness.unregister).toHaveBeenCalledOnce()

    cleanup()
    cleanup()
    expect(harness.unsubscribe).toHaveBeenCalledOnce()
    expect(harness.unregister).toHaveBeenCalledOnce()
  })

  it('绑定发生在窗口已可见时也立即登记消费者', () => {
    harness.visible = true
    const consumer = { id: 'surface', priority: 1, onEscape: vi.fn() }

    const cleanup = bindGlobalEscapeConsumerToVisibility('voice-ime' as WindowType, consumer)

    expect(harness.isVisible).toHaveBeenCalledWith('voice-ime')
    expect(harness.register).toHaveBeenCalledOnce()

    cleanup()
    expect(harness.unregister).toHaveBeenCalledOnce()
  })
})
