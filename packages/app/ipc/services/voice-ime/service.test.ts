/** Voice IME IPC 的门禁、窗口就绪和跨会话异步边界。 */

import { WindowType } from '@shared'
import type { BrowserWindow } from 'electron'
import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type FakeWebContents = EventEmitter & {
  id: number
  destroyed: boolean
  owner?: FakeWindow
  isDestroyed: () => boolean
}

type FakeWindow = {
  webContents: FakeWebContents
  destroyed: boolean
  visible: boolean
  focused: boolean
  isDestroyed: () => boolean
  isVisible: () => boolean
  isFocused: () => boolean
}

function createFakeWindow(id: number): FakeWindow {
  const webContents = Object.assign(new EventEmitter(), {
    id,
    destroyed: false,
    isDestroyed() {
      return this.destroyed
    },
  }) as FakeWebContents
  const window = {
    webContents,
    destroyed: false,
    visible: true,
    focused: true,
    isDestroyed() {
      return this.destroyed
    },
    isVisible() {
      return this.visible
    },
    isFocused() {
      return this.focused
    },
  } satisfies FakeWindow
  webContents.owner = window
  return window
}

const harness = vi.hoisted(() => {
  const windows = new Map<WindowType, FakeWindow>()
  const emitter = { emit: vi.fn() }
  const storage = vi.fn(async () => true)
  const permission = vi.fn(async () => true)
  const whenReady = vi.fn(async () => true)
  const fromWebContents = vi.fn((sender: FakeWebContents) => sender.owner as unknown as BrowserWindow)

  return {
    windows,
    emitter,
    storage,
    permission,
    whenReady,
    fromWebContents,
    startEscapeWatcher: vi.fn(),
    stopEscapeWatcher: vi.fn(),
    impl: null as unknown,
    floatingWindow: null as FakeWindow | null,
  }
})

vi.mock('@ipc/core', () => ({
  createIpcService: vi.fn((_namespace: string, impl: unknown) => {
    harness.impl = impl
    return harness.emitter
  }),
  createMainToRendererEmitter: vi.fn(() => harness.emitter),
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: harness.fromWebContents,
  },
  net: {
    isOnline: () => true,
  },
}))

vi.mock('@main/permission-required', () => ({
  ensureMicrophonePermissionOrExplain: harness.permission,
}))

vi.mock('@main/recording-storage', () => ({
  ensureVoiceImeStorageAvailable: harness.storage,
}))

vi.mock('@main/voice-ime-escape', () => ({
  startVoiceImeEscapeWatcher: harness.startEscapeWatcher,
  stopVoiceImeEscapeWatcher: harness.stopEscapeWatcher,
}))

vi.mock('@main/window-manager', () => ({
  windowManager: {
    get: (type: WindowType) => harness.windows.get(type),
    getAll: () => harness.windows,
    create: vi.fn(() => harness.floatingWindow),
    showInactive: vi.fn(),
    hide: vi.fn(),
    whenReady: harness.whenReady,
  },
}))

const {
  cancelPendingVoiceImeStart,
  cancelVoiceImeSession,
  registerVoiceImeStartGuard,
  requestVoiceImeStart,
  requestVoiceImeStop,
  setVoiceImeTranscriptionDispatcher,
  startVoiceImeMode,
} = await import('./service')
const { voiceImeState } = await import('@main/voice-ime-state')
const {
  clearVoiceImeWindowState,
  registerVoiceImeEmbeddedHost,
  setVoiceImeFocusContext,
} = await import('./state')

type VoiceImeHandlers = {
  setEmbeddedHost: (event: unknown, host: unknown, active: unknown) => Promise<void>
  startClickMode: (event: unknown) => Promise<{ success: boolean; sessionId?: string; blockedBy?: string }>
  stopSession: (event: unknown, sessionId: unknown) => Promise<boolean>
  cancelSession: (event: unknown, sessionId: unknown) => Promise<boolean>
  beginTranscribing: (event: unknown, sessionId: unknown) => Promise<boolean>
  endSession: (event: unknown, sessionId: unknown) => Promise<boolean>
  releaseSession: (event: unknown, payload: unknown) => Promise<void>
  deliverTranscription: (event: unknown, payload: unknown) => Promise<void>
}

function handlers(): VoiceImeHandlers {
  return (harness.impl as { mainHandle: VoiceImeHandlers }).mainHandle
}

function eventFor(window: FakeWindow): { sender: FakeWebContents } {
  return { sender: window.webContents }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

const floatingSurface = {
  surface: 'floating' as const,
  window: null,
  host: null,
}

describe('Voice IME service', () => {
  let unregisterGuards: Array<() => void> = []

  beforeEach(() => {
    if (voiceImeState.hasSession) voiceImeState.cancelSession()
    clearVoiceImeWindowState()
    unregisterGuards.forEach((unregister) => unregister())
    unregisterGuards = []

    harness.windows.clear()
    harness.floatingWindow = createFakeWindow(20)
    harness.windows.set(WindowType.VOICE_IME, harness.floatingWindow)
    harness.storage.mockReset()
    harness.storage.mockResolvedValue(true)
    harness.permission.mockReset()
    harness.permission.mockResolvedValue(true)
    harness.whenReady.mockReset()
    harness.whenReady.mockResolvedValue(true)
    harness.fromWebContents.mockClear()
    harness.emitter.emit.mockClear()
    harness.startEscapeWatcher.mockClear()
    harness.stopEscapeWatcher.mockClear()
    setVoiceImeTranscriptionDispatcher(null)
  })

  it('完整尊重注册门禁返回的 disk 原因，并且不提前触发磁盘检查', async () => {
    unregisterGuards.push(registerVoiceImeStartGuard(() => 'disk'))

    const result = await requestVoiceImeStart({ resolvedSurface: floatingSurface })

    expect(result).toEqual({ started: false, blockedBy: 'disk' })
    expect(harness.storage).not.toHaveBeenCalled()
    expect(voiceImeState.hasSession).toBe(false)
    await flushMicrotasks()
    expect(harness.emitter.emit).toHaveBeenCalledWith(
      'status',
      { error: 'disk' },
      harness.floatingWindow as unknown as BrowserWindow,
    )
  })

  it('异步磁盘检查期间被取消后不会认领新会话', async () => {
    let resolveStorage!: (available: boolean) => void
    harness.storage.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveStorage = resolve
      }),
    )

    const pending = requestVoiceImeStart({ resolvedSurface: floatingSurface })
    await Promise.resolve()
    cancelPendingVoiceImeStart()
    resolveStorage(true)

    await expect(pending).resolves.toEqual({ started: false, blockedBy: 'aborted' })
    expect(voiceImeState.currentSessionId).toBeNull()
    expect(harness.permission).not.toHaveBeenCalled()
  })

  it('浮层加载失败后释放已经认领的会话，不发送迟到 start', async () => {
    harness.whenReady.mockResolvedValue(false)

    const sessionId = startVoiceImeMode('click', { resolvedSurface: floatingSurface })
    expect(sessionId).not.toBeNull()

    await flushMicrotasks()

    expect(voiceImeState.currentSessionId).toBeNull()
    expect(harness.emitter.emit.mock.calls.some(([event, payload]) => event === 'floatingStart' && payload.sessionId === sessionId)).toBe(false)
  })

  it('旧浮层 stop 在取消并重启后不会投给新 session', async () => {
    const firstSessionId = startVoiceImeMode('click', { resolvedSurface: floatingSurface })
    expect(firstSessionId).not.toBeNull()
    requestVoiceImeStop()
    expect(cancelVoiceImeSession('escape', firstSessionId!)).toBe(true)

    const secondSessionId = startVoiceImeMode('click', { resolvedSurface: floatingSurface })
    expect(secondSessionId).not.toBeNull()
    await flushMicrotasks()

    expect(voiceImeState.currentSessionId).toBe(secondSessionId)
    expect(harness.emitter.emit.mock.calls.some(([event, payload]) => event === 'floatingStop' && payload.sessionId === firstSessionId)).toBe(false)
  })

  it('旧 stop 的加载失败回调不会取消随后等待门禁的新启动', async () => {
    const firstSessionId = startVoiceImeMode('click', { resolvedSurface: floatingSurface })
    expect(firstSessionId).not.toBeNull()

    let resolveStopReady!: (ready: boolean) => void
    harness.whenReady.mockImplementationOnce(() =>
      new Promise((resolve) => {
        resolveStopReady = resolve
      })
    )
    requestVoiceImeStop()
    expect(cancelVoiceImeSession('escape', firstSessionId!)).toBe(true)

    let resolveStorage!: (available: boolean) => void
    harness.storage.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveStorage = resolve
      }),
    )
    const pendingStart = requestVoiceImeStart({ resolvedSurface: floatingSurface })
    await Promise.resolve()

    resolveStopReady(false)
    await flushMicrotasks()
    resolveStorage(true)

    await expect(pendingStart).resolves.toMatchObject({ started: true })
  })

  it('旧 session 的异步释放完成后不能清掉新 session', async () => {
    const owner = harness.floatingWindow!
    const firstSessionId = startVoiceImeMode('click', { resolvedSurface: floatingSurface })
    expect(firstSessionId).not.toBeNull()

    let resolveDispatch!: () => void
    setVoiceImeTranscriptionDispatcher(async () => {
      await new Promise<void>((resolve) => {
        resolveDispatch = resolve
      })
    })

    const release = handlers().releaseSession(eventFor(owner), {
      sessionId: firstSessionId,
      result: { text: 'old', duration: 1 },
    })
    await Promise.resolve()
    expect(voiceImeState.isDelivering).toBe(true)

    expect(cancelVoiceImeSession('escape', firstSessionId!)).toBe(true)
    const secondSessionId = startVoiceImeMode('click', { resolvedSurface: floatingSurface })
    expect(secondSessionId).not.toBeNull()

    resolveDispatch()
    await release

    expect(voiceImeState.currentSessionId).toBe(secondSessionId)
    expect(voiceImeState.currentPhase).toBe('recording')
  })

  it('IPC 只接受受管应用窗口，OAuth sender 不能发起会话', async () => {
    const oauthWindow = createFakeWindow(21)
    harness.windows.clear()
    harness.windows.set(WindowType.OAUTH, oauthWindow)

    const result = await handlers().startClickMode(eventFor(oauthWindow))

    expect(result).toEqual({ success: false, blockedBy: 'aborted' })
    expect(voiceImeState.hasSession).toBe(false)
  })

  it('补投允许窗口级 sourceHost，并把原始 payload 交给统一 dispatcher', async () => {
    const dispatcher = vi.fn(async () => {})
    setVoiceImeTranscriptionDispatcher(dispatcher)

    await handlers().deliverTranscription(eventFor(harness.floatingWindow!), {
      text: 'window result',
      sourceHost: 'window',
    })

    expect(dispatcher).toHaveBeenCalledWith(
      { text: 'window result', sourceHost: 'window' },
      expect.objectContaining({ sessionId: null, host: null }),
    )
  })

  it('统一 stopSession/cancelSession 校验 sessionId，并允许受管菜单栏停止浮层会话', async () => {
    const owner = harness.floatingWindow!
    const staleOwner = createFakeWindow(23)
    const menubar = createFakeWindow(24)
    harness.windows.set(WindowType.MAIN, staleOwner)
    harness.windows.set(WindowType.MENUBAR, menubar)
    const sessionId = startVoiceImeMode('click', { resolvedSurface: floatingSurface })
    expect(sessionId).not.toBeNull()

    expect(await handlers().stopSession(eventFor(staleOwner), sessionId)).toBe(false)
    expect(voiceImeState.currentPhase).toBe('recording')
    expect(await handlers().beginTranscribing(eventFor(owner), sessionId)).toBe(true)
    expect(voiceImeState.currentPhase).toBe('processing')
    expect(await handlers().endSession(eventFor(owner), sessionId)).toBe(true)
    expect(voiceImeState.currentSessionId).toBeNull()

    const menubarSessionId = startVoiceImeMode('click', { resolvedSurface: floatingSurface })
    expect(menubarSessionId).not.toBeNull()
    expect(await handlers().stopSession(eventFor(menubar), menubarSessionId)).toBe(true)
    expect(voiceImeState.currentPhase).toBe('processing')
    expect(await handlers().endSession(eventFor(owner), menubarSessionId)).toBe(true)

    const nextSessionId = startVoiceImeMode('click', { resolvedSurface: floatingSurface })
    expect(nextSessionId).not.toBeNull()
    expect(await handlers().cancelSession(eventFor(owner), nextSessionId)).toBe(true)
    expect(voiceImeState.currentSessionId).toBeNull()
    await flushMicrotasks()
    expect(harness.emitter.emit).toHaveBeenCalledWith('cancel', {
      reason: 'user',
      sessionId: nextSessionId,
      host: undefined,
    }, owner as unknown as BrowserWindow)
  })

  it('宿主注销会取消其冻结的嵌入会话', async () => {
    const owner = createFakeWindow(22)
    harness.windows.clear()
    harness.windows.set(WindowType.MAIN, owner)
    const senderEvent = eventFor(owner)
    await handlers().setEmbeddedHost(senderEvent, 'editor', true)
    setVoiceImeFocusContext(asWindow(owner), { editable: true, embeddedHost: 'editor' })
    registerVoiceImeEmbeddedHost(asWindow(owner), 'editor', true)

    const sessionId = startVoiceImeMode('click', {
      resolvedSurface: {
        surface: 'embedded',
        window: asWindow(owner),
        host: 'editor',
      },
    })
    expect(sessionId).not.toBeNull()

    await handlers().setEmbeddedHost(senderEvent, 'editor', false)

    expect(voiceImeState.currentSessionId).toBeNull()
    expect(harness.emitter.emit).toHaveBeenCalledWith('cancel', {
      reason: 'host-unavailable',
      sessionId,
      host: 'editor',
    }, asWindow(owner))
  })
})

function asWindow(window: FakeWindow): BrowserWindow {
  return window as unknown as BrowserWindow
}
