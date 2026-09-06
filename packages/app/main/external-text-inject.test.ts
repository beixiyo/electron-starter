/**
 * 外部 App 文本投递的回退契约
 *
 * 原生直插是新路径，兼容性未知：辅助程序缺失（dev 未构建）、目标 App 两条路径都不吃时，
 * 文本必须仍经剪贴板粘贴送达，不能把整段输入丢掉；反过来直插成功时不得再碰剪贴板
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  insertTextAtFocusedInput: vi.fn(),
  pasteText: vi.fn(async () => {}),
}))

vi.mock('./insert-text', () => ({ insertTextAtFocusedInput: harness.insertTextAtFocusedInput }))
vi.mock('./utils', () => ({ pasteText: harness.pasteText }))

const { injectTextToExternalInput } = await import('./external-text-inject')

describe('外部 App 文本投递策略', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('macOS 原生直插成功时不碰剪贴板', async () => {
    harness.insertTextAtFocusedInput.mockResolvedValue({ ok: true, method: 'ax', reason: null, app: 'Notes' })

    const outcome = await injectTextToExternalInput('你好', { platform: 'darwin' })

    expect(outcome).toEqual({ method: 'ax', fallbackReason: null })
    expect(harness.pasteText).not.toHaveBeenCalled()
  })

  it('两条原生路径都失败时回退剪贴板粘贴并带回原因', async () => {
    harness.insertTextAtFocusedInput.mockResolvedValue({ ok: false, method: null, reason: 'paste-event-failed', app: 'Terminal' })

    const outcome = await injectTextToExternalInput('你好', { platform: 'darwin' })

    expect(harness.pasteText).toHaveBeenCalledWith('你好')
    expect(outcome).toEqual({ method: 'clipboard', fallbackReason: 'paste-event-failed' })
  })

  it('辅助程序缺失或崩溃时同样回退，不丢文本', async () => {
    harness.insertTextAtFocusedInput.mockRejectedValue(new Error('spawn ENOENT'))

    const outcome = await injectTextToExternalInput('你好', { platform: 'darwin' })

    expect(harness.pasteText).toHaveBeenCalledWith('你好')
    expect(outcome.method).toBe('clipboard')
    expect(outcome.fallbackReason).toContain('ENOENT')
  })

  it('非 macOS 直接走剪贴板粘贴，不调原生辅助程序', async () => {
    const outcome = await injectTextToExternalInput('hello', { platform: 'win32' })

    expect(harness.insertTextAtFocusedInput).not.toHaveBeenCalled()
    expect(harness.pasteText).toHaveBeenCalledWith('hello')
    expect(outcome.method).toBe('clipboard')
  })
})
