import type { ShortcutBinding, ShortcutBindings } from '@shared/shortcuts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createShortcutConfigService } from './service'

const harness = vi.hoisted(() => {
  const state: {
    bindings: ShortcutBindings
    impl: any
    emitter: { emit: ReturnType<typeof vi.fn> }
    suspended: boolean
    mainWindow: FakeBrowserWindow | null
  } = {
    bindings: {},
    impl: null,
    emitter: { emit: vi.fn() },
    suspended: false,
    mainWindow: null,
  }

  class FakeBrowserWindow {
    focused = true
    destroyed = false
    webContents: { id: number }

    constructor(id: number) {
      this.webContents = { id, once: vi.fn(), off: vi.fn(), isDestroyed: () => false } as never
    }

    static fromWebContents(sender: { window?: FakeBrowserWindow }): FakeBrowserWindow | null {
      return sender.window ?? null
    }

    isFocused(): boolean {
      return this.focused
    }

    isDestroyed(): boolean {
      return this.destroyed
    }

    once = vi.fn()
    off = vi.fn()
  }

  const createIpcService = vi.fn((_namespace: string, impl: unknown) => {
    state.impl = impl
    return state.emitter
  })

  return { state, FakeBrowserWindow, createIpcService }
})

vi.mock('electron', () => ({ BrowserWindow: harness.FakeBrowserWindow }))
vi.mock('@ipc/core', () => ({ createIpcService: harness.createIpcService }))
vi.mock('@main/shortcuts', () => ({
  filterPersistableShortcutBindings: (bindings: ShortcutBindings) => bindings,
  getElectronShortcutCapabilities: vi.fn(),
  getElectronShortcutRuntimeCapabilities: vi.fn(),
  isShortcutRuntimeSuspended: () => harness.state.suspended,
  resolveRuntimeShortcutBindings: (bindings: ShortcutBindings) => bindings,
  resumeShortcutRuntime: vi.fn(),
  startRecordShortcutDetection: vi.fn(),
  stopRecordShortcutDetection: vi.fn(),
  suspendShortcutRuntime: vi.fn(),
}))
vi.mock('@main/store/shortcut-bindings', () => ({
  normalizeShortcutBindingsForWrite: (bindings: ShortcutBindings) => bindings,
  readShortcutBindings: () => harness.state.bindings,
  writeShortcutBindings: vi.fn(),
}))
vi.mock('@main/window-manager', () => ({
  windowManager: { getMainWindow: () => harness.state.mainWindow },
}))

describe('快捷键配置触发边界', () => {
  beforeEach(() => {
    harness.state.bindings = {}
    harness.state.impl = null
    harness.state.emitter.emit.mockReset()
    harness.state.suspended = false
    harness.state.mainWindow = null
  })

  it('要求窗口聚焦，并使用主进程绑定重建事件', async () => {
    const binding = keyboardBinding('press')
    harness.state.bindings = { recording: binding }
    const onTrigger = vi.fn()
    createShortcutConfigService({ onReapply: vi.fn(), onTrigger })

    const { sender, window } = makeSender(1)
    await invokeTrigger(sender, {
      id: 'recording',
      phase: 'trigger',
      binding: fnBinding(),
    })

    expect(onTrigger).toHaveBeenCalledWith({
      id: 'recording',
      phase: 'trigger',
      gesture: 'press',
      binding,
    })

    window.focused = false
    await invokeTrigger(sender, {
      id: 'recording',
      phase: 'trigger',
      gesture: 'press',
    })
    expect(onTrigger).toHaveBeenCalledTimes(1)
  })

  it('拒绝全局绑定、非键盘绑定、无效阶段和畸形请求', async () => {
    const onTrigger = vi.fn()
    const { sender } = makeSender(1)
    createShortcutConfigService({ onReapply: vi.fn(), onTrigger })

    for (const binding of [
      { ...keyboardBinding('press'), scope: 'global' as const },
      fnBinding(),
    ]) {
      harness.state.bindings = { recording: binding }
      await invokeTrigger(sender, { id: 'recording', phase: 'trigger' })
    }

    harness.state.bindings = { recording: keyboardBinding('press') }
    await invokeTrigger(sender, { id: 'recording', phase: 'release' })
    await invokeTrigger(sender, null)

    expect(onTrigger).not.toHaveBeenCalled()
  })

  it('只接受由开启长按会话的发送方发出的释放请求', async () => {
    const binding = keyboardBinding('hold')
    harness.state.bindings = { voiceDictation: binding }
    const onTrigger = vi.fn()
    createShortcutConfigService({ onReapply: vi.fn(), onTrigger })

    const first = makeSender(1)
    const second = makeSender(2)
    await invokeTrigger(first.sender, { id: 'voiceDictation', phase: 'trigger' })
    await invokeTrigger(first.sender, { id: 'voiceDictation', phase: 'trigger' })
    await invokeTrigger(second.sender, { id: 'voiceDictation', phase: 'release' })

    expect(onTrigger).toHaveBeenCalledTimes(1)

    first.window.focused = false
    await invokeTrigger(first.sender, { id: 'voiceDictation', phase: 'release' })

    expect(onTrigger).toHaveBeenCalledTimes(2)
    expect(onTrigger.mock.calls[1][0]).toEqual({
      id: 'voiceDictation',
      phase: 'release',
      gesture: 'hold',
      binding,
    })
  })

  it('录制暂停期间拒绝新触发，但允许既有 hold 收尾', async () => {
    const binding = keyboardBinding('hold')
    harness.state.bindings = { voiceDictation: binding }
    const onTrigger = vi.fn()
    createShortcutConfigService({ onReapply: vi.fn(), onTrigger })
    const { sender } = makeSender(1)

    await invokeTrigger(sender, { id: 'voiceDictation', phase: 'trigger' })
    harness.state.suspended = true
    await invokeTrigger(sender, { id: 'voiceDictation', phase: 'trigger' })
    await invokeTrigger(sender, { id: 'voiceDictation', phase: 'release' })

    expect(onTrigger.mock.calls.map(call => call[0].phase)).toEqual(['trigger', 'release'])
  })

  it('拒绝子 frame 和远程页面调用快捷键动作', async () => {
    harness.state.bindings = { recording: keyboardBinding('press') }
    const onTrigger = vi.fn()
    createShortcutConfigService({ onReapply: vi.fn(), onTrigger })
    const { sender } = makeSender(1)

    await harness.state.impl.mainHandle.trigger(
      { sender, senderFrame: { url: 'file:///app/index.html' } },
      { id: 'recording', phase: 'trigger' },
    )
    sender.mainFrame.url = 'https://example.com/'
    await invokeTrigger(sender, { id: 'recording', phase: 'trigger' })

    expect(onTrigger).not.toHaveBeenCalled()
  })
})

function keyboardBinding(gesture: 'press' | 'hold'): ShortcutBinding {
  return {
    scope: 'local',
    gesture,
    chord: {
      source: 'keyboard',
      key: 'R',
      modifiers: [],
    },
  }
}

function fnBinding(): ShortcutBinding {
  return {
    scope: 'local',
    gesture: 'press',
    chord: {
      source: 'fn',
      key: 'Space',
    },
  }
}

function makeSender(id: number): {
  sender: {
    id: number
    isDestroyed: () => boolean
    window: InstanceType<typeof harness.FakeBrowserWindow>
    mainFrame: { url: string }
  }
  window: InstanceType<typeof harness.FakeBrowserWindow>
} {
  const window = new harness.FakeBrowserWindow(id)
  const sender = {
    id,
    isDestroyed: () => false,
    once: vi.fn(),
    off: vi.fn(),
    window,
    mainFrame: { url: 'file:///app/index.html' },
  }
  return { sender, window }
}

async function invokeTrigger(sender: { id: number }, request: unknown): Promise<void> {
  await harness.state.impl.mainHandle.trigger({ sender, senderFrame: (sender as any).mainFrame }, request)
}
