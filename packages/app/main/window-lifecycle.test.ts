/** 关闭隐藏必须与更新退出销毁成对，避免安装等待窗口关闭时挂起 */
import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ windows: [] as Electron.BrowserWindow[] }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return { app: new EventEmitter(), autoUpdater: new EventEmitter(), BrowserWindow: { getAllWindows: () => state.windows } }
})
import { app, autoUpdater } from 'electron'
import { attachMainWindowCloseBehavior, initWindowQuitCleanup } from './window-lifecycle'

afterEach(() => {
  vi.restoreAllMocks()
  app.removeAllListeners()
  autoUpdater.removeAllListeners()
  state.windows = []
})

it('macOS 关闭只隐藏，更新安装销毁所有窗口', () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
  const win = Object.assign(new EventEmitter(), { isFullScreen: () => false, hide: vi.fn(), isDestroyed: () => false, destroy: vi.fn() })
  const other = { isDestroyed: () => false, destroy: vi.fn() }
  state.windows = [win, other] as unknown as Electron.BrowserWindow[]
  attachMainWindowCloseBehavior(state.windows[0])
  initWindowQuitCleanup()
  const preventDefault = vi.fn()
  win.emit('close', { preventDefault })
  expect(preventDefault).toHaveBeenCalledOnce()
  expect(win.hide).toHaveBeenCalledOnce()
  expect(win.destroy).not.toHaveBeenCalled()
  autoUpdater.emit('before-quit-for-update')
  expect(win.destroy).toHaveBeenCalledOnce()
  expect(other.destroy).toHaveBeenCalledOnce()
})

it('其他平台不拦截；macOS 全屏先退 Space 再隐藏', () => {
  const win = Object.assign(new EventEmitter(), { isFullScreen: () => true, hide: vi.fn(), isDestroyed: () => false, setFullScreen: vi.fn() })
  const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  attachMainWindowCloseBehavior(win as unknown as Electron.BrowserWindow)
  expect(win.listenerCount('close')).toBe(0)
  platform.mockReturnValue('darwin')
  attachMainWindowCloseBehavior(win as unknown as Electron.BrowserWindow)
  win.emit('close', { preventDefault: vi.fn() })
  expect(win.setFullScreen).toHaveBeenCalledWith(false)
  expect(win.hide).not.toHaveBeenCalled()
  win.emit('leave-full-screen')
  expect(win.hide).toHaveBeenCalledOnce()
})
