/** 主窗重建入口必须等待实例的加载结果，不提前投递页面事件 */
import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
vi.mock('./window-manager', () => ({ windowManager: { get: () => undefined } }))
import { ensureMainWindowReady, registerMainWindowOpener } from './main-window-opener'
import { trackWindowReadiness } from './window-readiness'

it('由装配回调重建后，等待该实例主页面成功加载', async () => {
  const contents = Object.assign(new EventEmitter(), { isDestroyed: () => false })
  const win = Object.assign(new EventEmitter(), { webContents: contents, isDestroyed: () => false })
  const window = win as unknown as Electron.BrowserWindow
  trackWindowReadiness(window)
  const open = vi.fn(() => window)
  registerMainWindowOpener(open)
  const pending = ensureMainWindowReady()
  const settled = vi.fn()
  void pending.then(settled)
  await Promise.resolve()
  expect(settled).not.toHaveBeenCalled()
  contents.emit('did-finish-load')
  expect(await pending).toBe(win)
  expect(open).toHaveBeenCalledOnce()
  win.emit('closed')
})
