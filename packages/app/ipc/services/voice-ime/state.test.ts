/** Voice IME 宿主登记的目标选择、销毁清理和异步复验。 */

import type { BrowserWindow } from 'electron'
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearVoiceImeWindowState,
  freezeVoiceImeSessionTarget,
  getVoiceImeFocusedEmbeddedTarget,
  getVoiceImeForegroundEmbeddedTarget,
  isResolvedVoiceImeSurfaceAvailable,
  registerVoiceImeEmbeddedHost,
  type ResolvedVoiceImeSurface,
  setVoiceImeFocusContext,
} from './state'

class FakeWebContents extends EventEmitter {
  constructor(public readonly id: number) {
    super()
  }

  destroyed = false

  isDestroyed(): boolean {
    return this.destroyed
  }
}

class FakeWindow extends EventEmitter {
  readonly webContents: FakeWebContents
  focused = true
  visible = true
  destroyed = false

  constructor(id: number) {
    super()
    this.webContents = new FakeWebContents(id)
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  isFocused(): boolean {
    return this.focused
  }

  isVisible(): boolean {
    return this.visible
  }
}

function asWindow(window: FakeWindow): BrowserWindow {
  return window as unknown as BrowserWindow
}

describe('Voice IME 宿主状态', () => {
  let window: FakeWindow

  beforeEach(() => {
    clearVoiceImeWindowState()
    window = new FakeWindow(11)
  })

  afterEach(() => {
    clearVoiceImeWindowState()
  })

  it('焦点无宿主时不按最后登记顺序猜目标，显式默认宿主才可兜底', () => {
    const appWindow = asWindow(window)
    registerVoiceImeEmbeddedHost(appWindow, 'host-a', true)
    registerVoiceImeEmbeddedHost(appWindow, 'host-b', true)
    setVoiceImeFocusContext(appWindow, { editable: true })

    expect(getVoiceImeFocusedEmbeddedTarget()).toBeNull()
    expect(getVoiceImeForegroundEmbeddedTarget()).toBeNull()

    registerVoiceImeEmbeddedHost(appWindow, 'host-b', true, { default: true })

    expect(getVoiceImeForegroundEmbeddedTarget()).toMatchObject({ window: appWindow, host: 'host-b' })
  })

  it('相同 hostId 出现在另一前台窗口时不误用旧窗口的冻结宿主', () => {
    const foreground = new FakeWindow(12)
    window.focused = false
    foreground.focused = true
    const originalWindow = asWindow(window)
    const foregroundWindow = asWindow(foreground)

    registerVoiceImeEmbeddedHost(originalWindow, 'shared-host', true)
    registerVoiceImeEmbeddedHost(foregroundWindow, 'shared-host', true)
    setVoiceImeFocusContext(foregroundWindow, { editable: true })
    freezeVoiceImeSessionTarget(originalWindow, 'shared-host')

    expect(getVoiceImeForegroundEmbeddedTarget()).toBeNull()
  })

  it('宿主窗口销毁后清掉焦点和默认目标', () => {
    const appWindow = asWindow(window)
    registerVoiceImeEmbeddedHost(appWindow, 'host-a', true, { default: true })
    setVoiceImeFocusContext(appWindow, { editable: true, embeddedHost: 'host-a' })

    window.destroyed = true
    window.webContents.destroyed = true
    window.webContents.emit('destroyed')

    expect(getVoiceImeFocusedEmbeddedTarget()).toBeNull()
    expect(getVoiceImeForegroundEmbeddedTarget()).toBeNull()
  })

  it('异步门禁复验同时要求登记仍在且窗口仍可见', () => {
    const appWindow = asWindow(window)
    registerVoiceImeEmbeddedHost(appWindow, 'host-a', true)
    const resolved: ResolvedVoiceImeSurface = {
      surface: 'embedded',
      window: appWindow,
      host: 'host-a',
    }

    expect(isResolvedVoiceImeSurfaceAvailable(resolved)).toBe(true)
    window.visible = false
    expect(isResolvedVoiceImeSurfaceAvailable(resolved)).toBe(false)
    window.visible = true
    registerVoiceImeEmbeddedHost(appWindow, 'host-a', false)
    expect(isResolvedVoiceImeSurfaceAvailable(resolved)).toBe(false)
  })
})
