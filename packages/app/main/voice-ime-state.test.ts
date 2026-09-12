/** Voice IME 会话槽位的身份、投递锁和 owner 生命周期。 */

import type { BrowserWindow } from 'electron'
import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it } from 'vitest'
import { VoiceImeStateManager } from './voice-ime-state'

class FakeWebContents extends EventEmitter {
  constructor(public readonly id: number) {
    super()
  }

  destroyed = false

  isDestroyed(): boolean {
    return this.destroyed
  }
}

class FakeWindow {
  readonly webContents: FakeWebContents
  destroyed = false

  constructor(id: number) {
    this.webContents = new FakeWebContents(id)
  }

  isDestroyed(): boolean {
    return this.destroyed
  }
}

function asWindow(window: FakeWindow): BrowserWindow {
  return window as unknown as BrowserWindow
}

function openRecordingSession(manager: VoiceImeStateManager, window: FakeWindow, sessionId: string): void {
  expect(manager.openSession({
    sessionId,
    owner: asWindow(window),
    surface: 'floating',
    host: null,
    mode: 'click',
  })).toBe(true)
  expect(manager.setPhase('recording')).toBe(true)
}

describe('VoiceImeStateManager', () => {
  let manager: VoiceImeStateManager

  beforeEach(() => {
    manager = new VoiceImeStateManager()
  })

  it('取消旧投递后允许新会话，但旧完成回调不能清掉新会话', () => {
    const firstWindow = new FakeWindow(1)
    const secondWindow = new FakeWindow(2)
    openRecordingSession(manager, firstWindow, 'session-a')

    expect(manager.beginDelivery('session-a', asWindow(firstWindow))).toMatchObject({ sessionId: 'session-a' })
    expect(manager.cancelSession('session-a')?.sessionId).toBe('session-a')

    openRecordingSession(manager, secondWindow, 'session-b')

    expect(manager.completeDelivery('session-a')).toBe(false)
    expect(manager.currentSessionId).toBe('session-b')
    expect(manager.currentPhase).toBe('recording')
  })

  it('投递锁期间拒绝新的 owner 和旧 sender 的相位回写', () => {
    const owner = new FakeWindow(3)
    const staleSender = new FakeWindow(4)
    openRecordingSession(manager, owner, 'session-a')

    expect(manager.beginDelivery('session-a', asWindow(owner))).not.toBeNull()
    expect(manager.openSession({
      sessionId: 'session-b',
      owner: asWindow(staleSender),
      surface: 'embedded',
      host: 'editor',
      mode: 'click',
    })).toBe(false)
    expect(manager.setSessionPhase('session-a', asWindow(staleSender), 'processing')).toBe(false)
    expect(manager.currentSessionId).toBe('session-a')
  })

  it('owner 的 webContents 销毁会清空会话并通知固定原因', () => {
    const owner = new FakeWindow(5)
    const invalidations: string[] = []
    manager.onSessionInvalidated((_context, reason) => invalidations.push(reason))
    openRecordingSession(manager, owner, 'session-a')

    owner.destroyed = true
    owner.webContents.destroyed = true
    owner.webContents.emit('destroyed')

    expect(manager.currentSessionId).toBeNull()
    expect(manager.currentPhase).toBe('idle')
    expect(invalidations).toEqual(['window-closed'])
  })
})
