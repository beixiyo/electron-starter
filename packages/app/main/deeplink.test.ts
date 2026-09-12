import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  platform: 'darwin' as NodeJS.Platform,
  systemVersion: '14.1.0',
  showErrorBox: vi.fn(),
  app: {
    whenReady: vi.fn(() => Promise.resolve()),
    requestSingleInstanceLock: vi.fn(() => true),
    setAsDefaultProtocolClient: vi.fn(),
    quit: vi.fn(),
    on: vi.fn(),
  },
}))

vi.mock('electron', () => ({
  app: harness.app,
  dialog: {
    showErrorBox: harness.showErrorBox,
  },
}))

vi.mock('@ipc/services/oauth/service', () => ({
  sendOAuthCallback: vi.fn(),
}))

vi.mock('./main-window-opener', () => ({
  ensureMainWindowReady: vi.fn(),
}))

vi.mock('./window-manager', () => ({
  windowManager: {
    get: vi.fn(),
    show: vi.fn(),
  },
}))

import { initDeeplink } from './deeplink'

type ProcessWithSystemVersion = NodeJS.Process & {
  getSystemVersion?: () => string
}

const processWithSystemVersion = process as ProcessWithSystemVersion
const originalGetSystemVersion = Object.getOwnPropertyDescriptor(processWithSystemVersion, 'getSystemVersion')

async function flushStartup(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

describe('macOS 启动版本门禁', () => {
  beforeEach(() => {
    harness.platform = 'darwin'
    harness.systemVersion = '14.1.0'
    harness.app.whenReady.mockClear().mockResolvedValue(undefined)
    harness.app.requestSingleInstanceLock.mockClear().mockReturnValue(true)
    harness.app.setAsDefaultProtocolClient.mockClear()
    harness.app.quit.mockClear()
    harness.showErrorBox.mockClear()
    harness.app.on.mockClear()

    vi.spyOn(process, 'platform', 'get').mockImplementation(() => harness.platform)
    Object.defineProperty(processWithSystemVersion, 'getSystemVersion', {
      configurable: true,
      value: () => harness.systemVersion,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (originalGetSystemVersion) {
      Object.defineProperty(processWithSystemVersion, 'getSystemVersion', originalGetSystemVersion)
    }
    else {
      Object.defineProperty(processWithSystemVersion, 'getSystemVersion', {
        configurable: true,
        value: undefined,
      })
    }
  })

  it('低于配置版本时退出且不进入应用初始化', async () => {
    const whenReady = vi.fn()

    initDeeplink(whenReady, vi.fn(), {
      minimumMacOS: { major: 14, minor: 2 },
    })
    await flushStartup()

    expect(harness.showErrorBox).toHaveBeenCalledWith(
      'macOS Version Not Supported',
      expect.stringContaining('requires macOS 14.2 or later'),
    )
    expect(harness.app.quit).toHaveBeenCalledOnce()
    expect(whenReady).not.toHaveBeenCalled()
  })

  it('达到配置版本时进入应用初始化', async () => {
    harness.systemVersion = '14.2.0'
    const whenReady = vi.fn()

    initDeeplink(whenReady, vi.fn(), {
      minimumMacOS: { major: 14, minor: 2 },
    })
    await flushStartup()

    expect(harness.showErrorBox).not.toHaveBeenCalled()
    expect(harness.app.quit).not.toHaveBeenCalled()
    expect(whenReady).toHaveBeenCalledOnce()
  })

  it('未配置版本门槛时不限制 macOS 启动', async () => {
    const whenReady = vi.fn()

    initDeeplink(whenReady, vi.fn())
    await flushStartup()

    expect(harness.showErrorBox).not.toHaveBeenCalled()
    expect(harness.app.quit).not.toHaveBeenCalled()
    expect(whenReady).toHaveBeenCalledOnce()
  })

  it('非 macOS 平台不受版本门禁影响', async () => {
    harness.platform = 'win32'
    harness.systemVersion = '1.0.0'
    const whenReady = vi.fn()

    initDeeplink(whenReady, vi.fn(), {
      minimumMacOS: { major: 99, minor: 99 },
    })
    await flushStartup()

    expect(harness.showErrorBox).not.toHaveBeenCalled()
    expect(harness.app.quit).not.toHaveBeenCalled()
    expect(whenReady).toHaveBeenCalledOnce()
  })
})
