/**
 * 外部 App 文本投递的回退契约
 *
 * 辅助程序缺失（dev 未构建）或崩溃时文本必须仍经剪贴板粘贴送达，不能把整段输入丢掉；
 * 直插成功时不得再碰剪贴板；粘贴发出去却没人读剪贴板时必须如实报「没送达」，
 * 不得再退一次裸粘贴——那正是曾经文本无声消失的路径
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  insertTextAtFocusedInput: vi.fn(),
  pasteText: vi.fn(async () => {}),
}))

vi.mock('./insert-text', () => ({
  insertTextAtFocusedInput: harness.insertTextAtFocusedInput,
  PASTE_NOT_CONSUMED_REASON: 'paste-not-consumed',
}))
vi.mock('./utils', () => ({ pasteText: harness.pasteText }))

const { injectTextToExternalInput } = await import('./external-text-inject')

describe('外部 App 文本投递策略', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('macOS 原生直插成功时不碰剪贴板', async () => {
    harness.insertTextAtFocusedInput.mockResolvedValue({ ok: true, method: 'ax', reason: null, app: 'Notes', receiptMs: null, receiptCount: 0 })

    const outcome = await injectTextToExternalInput('你好', { platform: 'darwin' })

    expect(outcome).toEqual({ delivered: true, method: 'ax', fallbackReason: null, receiptMs: null })
    expect(harness.pasteText).not.toHaveBeenCalled()
  })

  it('粘贴预算内没有读回执时报未送达，不退裸粘贴、不碰剪贴板', async () => {
    harness.insertTextAtFocusedInput.mockResolvedValue({ ok: false, method: null, reason: 'paste-not-consumed', app: 'Finder', receiptMs: null, receiptCount: 0 })

    const outcome = await injectTextToExternalInput('你好', { platform: 'darwin' })

    expect(outcome).toEqual({ delivered: false, method: null, reason: 'paste-not-consumed', receiptMs: null })
    expect(harness.pasteText).not.toHaveBeenCalled()
  })

  it('Cmd+V 事件都发不出去时回退剪贴板粘贴并带回原因', async () => {
    harness.insertTextAtFocusedInput.mockResolvedValue({ ok: false, method: null, reason: 'paste-event-failed', app: 'Terminal', receiptMs: null, receiptCount: 0 })

    const outcome = await injectTextToExternalInput('你好', { platform: 'darwin' })

    expect(harness.pasteText).toHaveBeenCalledWith('你好')
    expect(outcome).toEqual({ delivered: true, method: 'clipboard', fallbackReason: 'paste-event-failed', receiptMs: null })
  })

  it('辅助程序缺失或崩溃时同样回退，不丢文本', async () => {
    harness.insertTextAtFocusedInput.mockRejectedValue(new Error('spawn ENOENT'))

    const outcome = await injectTextToExternalInput('你好', { platform: 'darwin' })

    expect(harness.pasteText).toHaveBeenCalledWith('你好')
    expect(outcome).toMatchObject({ delivered: true, method: 'clipboard' })
    expect(outcome.delivered && outcome.fallbackReason).toContain('ENOENT')
  })

  it('非 macOS 直接走剪贴板粘贴，不调原生辅助程序', async () => {
    const outcome = await injectTextToExternalInput('hello', { platform: 'win32' })

    expect(harness.insertTextAtFocusedInput).not.toHaveBeenCalled()
    expect(harness.pasteText).toHaveBeenCalledWith('hello')
    expect(outcome.method).toBe('clipboard')
  })
})
