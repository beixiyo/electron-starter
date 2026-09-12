import type { BrowserWindow } from 'electron'
import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { trackWindowReadiness, waitForWindowReady } from './window-readiness'

describe('窗口加载就绪状态', () => {
  it('主框架加载失败后再次等待会返回 false', async () => {
    const { contents, window } = createWindow()
    trackWindowReadiness(window)

    emitNavigationStart(contents, false, true)
    emitLoadFailure(contents, true)

    await expect(waitForWindowReady(window, { timeoutMs: 100 })).resolves.toBe(false)
  })

  it('正常 reload 会重新进入等待状态并在下一次成功加载后恢复 ready', async () => {
    const { contents, window } = createWindow()
    trackWindowReadiness(window)

    contents.emit('did-finish-load')
    await expect(waitForWindowReady(window)).resolves.toBe(true)

    emitNavigationStart(contents, false, true)
    let settled = false
    const pending = waitForWindowReady(window, { timeoutMs: 100 })
    void pending.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    contents.emit('did-finish-load')
    await expect(pending).resolves.toBe(true)
  })

  it('忽略 subframe 失败，主框架成功后仍返回 ready', async () => {
    const { contents, window } = createWindow()
    trackWindowReadiness(window)

    emitNavigationStart(contents, false, true)
    const pending = waitForWindowReady(window, { timeoutMs: 100 })
    let settled = false
    void pending.then(() => {
      settled = true
    })

    emitLoadFailure(contents, false)
    await Promise.resolve()
    expect(settled).toBe(false)

    contents.emit('did-finish-load')
    await expect(pending).resolves.toBe(true)
  })

  it('忽略 subframe 和同文档导航，不会把 ready 主框架误置为 pending', async () => {
    const { contents, window } = createWindow()
    trackWindowReadiness(window)
    contents.emit('did-finish-load')
    await expect(waitForWindowReady(window)).resolves.toBe(true)

    emitNavigationStart(contents, false, false)
    await expect(waitForWindowReady(window)).resolves.toBe(true)

    emitNavigationStart(contents, true, true)
    await expect(waitForWindowReady(window)).resolves.toBe(true)

    emitNavigationStart(contents, false, true)
    let settled = false
    const pending = waitForWindowReady(window, { timeoutMs: 100 })
    void pending.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    contents.emit('did-finish-load')
    await expect(pending).resolves.toBe(true)
  })

  it('重复跟踪不重复注册监听，窗口关闭会结束等待并清理监听', async () => {
    const { contents, window } = createWindow()
    trackWindowReadiness(window)
    trackWindowReadiness(window)

    expect(contents.listenerCount('did-start-navigation')).toBe(1)
    expect(contents.listenerCount('did-finish-load')).toBe(1)
    expect(contents.listenerCount('did-fail-load')).toBe(1)
    expect(contents.listenerCount('destroyed')).toBe(1)
    expect(window.listenerCount('closed')).toBe(1)

    const pending = waitForWindowReady(window, { timeoutMs: 100 })
    window.emit('closed')

    await expect(pending).resolves.toBe(false)
    expect(contents.listenerCount('did-start-navigation')).toBe(0)
    expect(contents.listenerCount('did-finish-load')).toBe(0)
    expect(contents.listenerCount('did-fail-load')).toBe(0)
    expect(contents.listenerCount('destroyed')).toBe(0)
    expect(window.listenerCount('closed')).toBe(0)
    await expect(waitForWindowReady(window)).resolves.toBe(false)
  })

  it('webContents disposed 时也结束等待并清理窗口监听', async () => {
    const { contents, window } = createWindow()
    trackWindowReadiness(window)
    const pending = waitForWindowReady(window, { timeoutMs: 100 })

    contents.emit('destroyed')

    await expect(pending).resolves.toBe(false)
    expect(window.listenerCount('closed')).toBe(0)
    expect(contents.listenerCount('did-finish-load')).toBe(0)
  })

  it.each([
    ['window', true, false],
    ['webContents', false, true],
  ])('跟踪已销毁的 %s 会立即返回 false', async (_name, windowDestroyed, contentsDestroyed) => {
    const { contents, window } = createWindow(windowDestroyed, contentsDestroyed)
    trackWindowReadiness(window)

    await expect(waitForWindowReady(window, { timeoutMs: 100 })).resolves.toBe(false)
    expect(contents.listenerCount('did-finish-load')).toBe(0)
    expect(window.listenerCount('closed')).toBe(0)
  })
})

function emitLoadFailure(contents: EventEmitter, isMainFrame: boolean): void {
  contents.emit('did-fail-load', {}, -2, 'failed', 'app://index', isMainFrame, 0, 0)
}

function emitNavigationStart(contents: EventEmitter, isInPlace: boolean, isMainFrame: boolean): void {
  contents.emit('did-start-navigation', {}, 'app://index', isInPlace, isMainFrame, 0, 0, false)
}

function createWindow(windowDestroyed = false, contentsDestroyed = false): { contents: EventEmitter; window: BrowserWindow } {
  const contents = new EventEmitter()
  Object.assign(contents, { isDestroyed: () => contentsDestroyed })
  const window = Object.assign(new EventEmitter(), {
    isDestroyed: () => windowDestroyed,
    webContents: contents,
  }) as unknown as BrowserWindow
  return { contents, window }
}
