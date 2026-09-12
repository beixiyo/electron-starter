/** 窗口控制必须保留池化占用边界及输入法临时层级的成对恢复 */
import type { ServiceImpl } from '@ipc/core'
import type { WindowContract } from './contract'
import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import { WindowType } from '@shared'

const harness = vi.hoisted(() => ({ impl: null as ServiceImpl<WindowContract> | null, window: null as unknown, hide: vi.fn(() => true), close: vi.fn(() => true) }))
vi.mock('@ipc/core', () => ({
  createIpcService: (_name: string, impl: ServiceImpl<WindowContract>) => {
    harness.impl = impl
    return {}
  },
}))
vi.mock('@main/devtools', () => ({ isDevToolsEnabled: () => false }))
vi.mock('@main/window-manager', () => ({
  getShortcutTestWindowBounds: vi.fn(),
  logicalWindowManager: { isPooled: (type: string) => type === 'selection', hide: harness.hide },
  windowManager: { close: harness.close, getAllTypes: () => ['voice-ime'], get: () => harness.window, getMetadata: () => ({ config: { alwaysOnTopLevel: 'screen-saver' } }) },
}))
vi.mock('electron', () => ({ BrowserWindow: { fromWebContents: () => harness.window }, shell: {} }))
import './service'

afterEach(() => vi.restoreAllMocks())

it('关闭池化角色只释放占用，不能关闭共享物理窗口', async () => {
  await harness.impl!.mainHandle.close({}, WindowType.SELECTION)
  expect(harness.hide).toHaveBeenCalledWith(WindowType.SELECTION)
  expect(harness.close).not.toHaveBeenCalled()
})

it('组字结束恢复配置层级，多次组字不积累失焦监听', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
  const win = Object.assign(new EventEmitter(), { isDestroyed: () => false, isAlwaysOnTop: () => true, isVisible: () => true, setAlwaysOnTop: vi.fn() })
  harness.window = win
  for (let i = 0; i < 3; i++) {
    await harness.impl!.mainHandle.setImeComposing({ sender: {} }, true)
    expect(win.listenerCount('blur')).toBe(1)
    await harness.impl!.mainHandle.setImeComposing({ sender: {} }, false)
    expect(win.listenerCount('blur')).toBe(0)
    expect(win.listenerCount('closed')).toBe(0)
    expect(win.setAlwaysOnTop).toHaveBeenLastCalledWith(true, 'screen-saver')
  }
  await harness.impl!.mainHandle.setImeComposing({ sender: {} }, true)
  win.emit('closed')
  expect(win.listenerCount('blur')).toBe(0)
  expect(win.listenerCount('closed')).toBe(0)
})
