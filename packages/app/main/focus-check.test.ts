/** focus-check helper 输出解析的行为测试 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  execFile: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  execFile: harness.execFile,
}))

vi.mock('./native-bridge', () => ({
  getNativeBinaryPath: () => '/mock/focus-check',
}))

const { checkFocusedTextInput } = await import('./focus-check')

describe.skipIf(process.platform !== 'darwin')('focus-check helper 输出解析', () => {
  beforeEach(() => {
    harness.execFile.mockReset()
  })

  it('保留 pasteable 档位并把它视为可投递目标', async () => {
    mockHelperResult({
      focused: true,
      tier: 'pasteable',
      reason: null,
      role: 'AXWindow',
      app: 'Editor',
      bundleId: 'com.example.editor',
      pid: 42,
      web: false,
      waitMs: 12,
      pasteMenuEnabled: false,
    })

    await expect(checkFocusedTextInput()).resolves.toEqual({
      focused: true,
      tier: 'pasteable',
      reason: null,
      role: 'AXWindow',
      app: 'Editor',
      bundleId: 'com.example.editor',
      pid: 42,
      webContent: false,
      focusWaitMs: 12,
      pasteMenuEnabled: false,
    })
  })

  it('按 tier 归一化 focused，未知档位不能把目标误判为可投递', async () => {
    mockHelperResult({
      focused: true,
      tier: 'future-tier',
      reason: 'focus-unavailable',
      role: 'AXTextArea',
      app: 'Editor',
      bundleId: 'com.example.editor',
      pid: 42,
      web: true,
      waitMs: 640,
      pasteMenuEnabled: true,
    })

    await expect(checkFocusedTextInput()).resolves.toMatchObject({
      focused: false,
      tier: 'none',
      reason: 'focus-unavailable',
      pasteMenuEnabled: true,
    })
  })

  it('helper 失败时返回完整的不可用结果', async () => {
    harness.execFile.mockImplementationOnce((...args: unknown[]) => {
      const callback = args.at(-1) as (error: Error, stdout: string) => void
      callback(new Error('helper unavailable'), '')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(checkFocusedTextInput()).resolves.toEqual({
      focused: false,
      tier: 'none',
      reason: 'helper-unavailable',
      role: null,
      app: null,
      bundleId: null,
      pid: -1,
      webContent: false,
      focusWaitMs: 0,
      pasteMenuEnabled: null,
    })

    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })
})

function mockHelperResult(result: Record<string, unknown>): void {
  harness.execFile.mockImplementationOnce((...args: unknown[]) => {
    const callback = args.at(-1) as (error: null, stdout: string) => void
    callback(null, JSON.stringify(result))
  })
}
