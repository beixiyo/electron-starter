/** 文本投递路由的行为测试：端内宿主、外部焦点档位与过期会话 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => {
  const appWindow = {
    isDestroyed: () => false,
    webContents: {
      insertText: vi.fn(async () => {}),
    },
  }
  const resultWindow = {
    isDestroyed: () => false,
  }

  return {
    appWindow,
    resultWindow,
    focusedWindow: null as typeof appWindow | null,
    focusedEditableWindow: null as typeof appWindow | null,
    focusedEmbeddedTarget: null as null | { window: typeof appWindow; host: string },
    foregroundEmbeddedTarget: null as null | { window: typeof appWindow; host: string },
    foregroundWindowHost: null as typeof appWindow | null,
    externalFocus: {
      focused: false,
      tier: 'none' as 'editable' | 'pasteable' | 'none',
      role: null,
      app: null,
      bundleId: null,
      pid: -1,
      pasteMenuEnabled: null,
    },
    currentSessionId: null as string | null,
    emit: vi.fn(),
    checkFocusedTextInput: vi.fn(),
    injectTextToExternalInput: vi.fn(async () => ({ method: 'ax' as const, fallbackReason: null })),
    insertTextAtFocusedInput: vi.fn(async () => ({ ok: true, method: 'paste' as const, reason: null, app: 'Editor' })),
    windowGet: vi.fn(),
    windowCreate: vi.fn(),
    windowWhenReady: vi.fn(async () => true),
    windowShowInactive: vi.fn(),
  }
})

vi.mock('electron', () => ({
  BrowserWindow: {
    getFocusedWindow: () => harness.focusedWindow,
  },
}))

vi.mock('@ipc/services/voice-ime/state', () => ({
  getVoiceImeFocusedEditableWindow: () => harness.focusedEditableWindow,
  getVoiceImeFocusedEmbeddedTarget: () => harness.focusedEmbeddedTarget,
  getVoiceImeForegroundEmbeddedTarget: () => harness.foregroundEmbeddedTarget,
  getVoiceImeForegroundWindowHost: () => harness.foregroundWindowHost,
}))

vi.mock('@ipc/services/voice-ime/toRenderer', () => ({
  voiceImeToRenderer: { emit: harness.emit },
}))

vi.mock('./external-text-inject', () => ({
  injectTextToExternalInput: harness.injectTextToExternalInput,
}))

vi.mock('./focus-check', () => ({
  checkFocusedTextInput: harness.checkFocusedTextInput,
}))

vi.mock('./insert-text', () => ({
  insertTextAtFocusedInput: harness.insertTextAtFocusedInput,
}))

vi.mock('./voice-ime-state', () => ({
  voiceImeState: {
    get currentSessionId() {
      return harness.currentSessionId
    },
  },
}))

vi.mock('./window-manager', () => ({
  windowManager: {
    get: harness.windowGet,
    create: harness.windowCreate,
    whenReady: harness.windowWhenReady,
    showInactive: harness.windowShowInactive,
  },
}))

const { dispatchTranscription } = await import('./voice-ime-inject')

describe('文本投递路由', () => {
  beforeEach(() => {
    harness.focusedWindow = null
    harness.focusedEditableWindow = null
    harness.focusedEmbeddedTarget = null
    harness.foregroundEmbeddedTarget = null
    harness.foregroundWindowHost = null
    harness.externalFocus = {
      focused: false,
      tier: 'none',
      role: null,
      app: null,
      bundleId: null,
      pid: -1,
      pasteMenuEnabled: null,
    }
    harness.currentSessionId = null
    harness.appWindow.webContents.insertText.mockReset()
    harness.appWindow.webContents.insertText.mockResolvedValue(undefined)
    harness.checkFocusedTextInput.mockReset()
    harness.checkFocusedTextInput.mockResolvedValue(harness.externalFocus)
    harness.injectTextToExternalInput.mockReset()
    harness.injectTextToExternalInput.mockResolvedValue({ method: 'ax', fallbackReason: null })
    harness.insertTextAtFocusedInput.mockReset()
    harness.insertTextAtFocusedInput.mockResolvedValue({ ok: true, method: 'paste', reason: null, app: 'Editor' })
    harness.windowGet.mockReset()
    harness.windowGet.mockReturnValue(harness.resultWindow)
    harness.windowCreate.mockReset()
    harness.windowCreate.mockReturnValue(harness.resultWindow)
    harness.windowWhenReady.mockReset()
    harness.windowWhenReady.mockResolvedValue(true)
    harness.windowShowInactive.mockReset()
    vi.clearAllMocks()
  })

  it('端内普通可写输入优先使用当前窗口 insertText', async () => {
    harness.focusedWindow = harness.appWindow
    harness.focusedEditableWindow = harness.appWindow

    await dispatchTranscription('internal')

    expect(harness.appWindow.webContents.insertText).toHaveBeenCalledWith('internal')
    expect(harness.checkFocusedTextInput).not.toHaveBeenCalled()
    expect(harness.injectTextToExternalInput).not.toHaveBeenCalled()
  })

  it('焦点位于已登记宿主时让位给宿主，不走 insertText', async () => {
    harness.focusedWindow = harness.appWindow
    harness.focusedEditableWindow = harness.appWindow
    harness.focusedEmbeddedTarget = { window: harness.appWindow, host: 'host-a' }
    harness.foregroundEmbeddedTarget = { window: harness.appWindow, host: 'host-a' }

    await dispatchTranscription('host text')

    expect(harness.appWindow.webContents.insertText).not.toHaveBeenCalled()
    expect(harness.emit).toHaveBeenCalledWith(
      'embeddedTranscription',
      { host: 'host-a', text: 'host text' },
      harness.appWindow,
    )
  })

  it('端外 editable 档位使用现有 auto 注入路径', async () => {
    harness.externalFocus.tier = 'editable'
    harness.checkFocusedTextInput.mockResolvedValue(harness.externalFocus)

    await dispatchTranscription('editable text')

    expect(harness.injectTextToExternalInput).toHaveBeenCalledWith('editable text')
    expect(harness.insertTextAtFocusedInput).not.toHaveBeenCalled()
  })

  it('端外 pasteable 档位强制原生 paste，不调用 auto 直插路径', async () => {
    harness.externalFocus.tier = 'pasteable'
    harness.checkFocusedTextInput.mockResolvedValue(harness.externalFocus)

    await dispatchTranscription('paste text')

    expect(harness.insertTextAtFocusedInput).toHaveBeenCalledWith('paste text', { method: 'paste' })
    expect(harness.injectTextToExternalInput).not.toHaveBeenCalled()
  })

  it('无可靠目标或注入失败时保留文本到结果窗口', async () => {
    await dispatchTranscription('keep this')

    expect(harness.emit).toHaveBeenCalledWith(
      'transcription',
      { text: 'keep this' },
      harness.resultWindow,
    )
    expect(harness.windowShowInactive).toHaveBeenCalledWith('voice-ime')
  })

  it('浮层结果带回当前会话身份，供 renderer 丢弃跨轮迟到结果', async () => {
    harness.currentSessionId = 'session-a'

    await dispatchTranscription('session result', { sessionId: 'session-a' })

    expect(harness.emit).toHaveBeenCalledWith(
      'transcription',
      { text: 'session result', sessionId: 'session-a' },
      harness.resultWindow,
    )
  })

  it('结果窗口加载失败时向调用方报告投递失败且不发送文本', async () => {
    harness.windowWhenReady.mockResolvedValue(false)

    await expect(dispatchTranscription('drop when not ready')).rejects.toThrow(
      'Voice IME result window failed to load',
    )

    expect(harness.emit).not.toHaveBeenCalled()
    expect(harness.windowShowInactive).not.toHaveBeenCalled()
  })

  it('结果窗口尚未 ready 时不会提前完成投递', async () => {
    let resolveReady!: (ready: boolean) => void
    harness.windowWhenReady.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveReady = resolve
      }),
    )

    const pending = dispatchTranscription('wait for ready')
    await Promise.resolve()
    expect(harness.emit).not.toHaveBeenCalled()
    expect(harness.windowShowInactive).not.toHaveBeenCalled()

    resolveReady(true)
    await pending

    expect(harness.emit).toHaveBeenCalledWith(
      'transcription',
      { text: 'wait for ready' },
      harness.resultWindow,
    )
    expect(harness.windowShowInactive).toHaveBeenCalledWith('voice-ime')
  })

  it('sessionId 过期后不再展示旧结果', async () => {
    harness.currentSessionId = 'session-a'
    let resolveFocus: ((focus: typeof harness.externalFocus) => void) | undefined
    harness.checkFocusedTextInput.mockImplementationOnce(() =>
      new Promise((resolve) => {
        resolveFocus = resolve
      })
    )

    const pending = dispatchTranscription('stale', { sessionId: 'session-a' })
    await Promise.resolve()
    harness.currentSessionId = 'session-b'
    resolveFocus?.(harness.externalFocus)
    await pending

    expect(harness.emit).not.toHaveBeenCalled()
    expect(harness.windowShowInactive).not.toHaveBeenCalled()
  })
})
