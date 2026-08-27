/**
 * `createIpcService` 的 `mainOn` 通道注册与错误兜底
 *
 * 覆盖 typecheck 无法保证的运行时分支：`mainOn` 必须走 `ipcMain.on`
 * 走错成 handle 会让 renderer 的 send 永远收不到）、handler 抛错必须被兜住并标对
 * `kind`（单向通道无处回传，漏掉就是静默丢失）
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcContract } from './contract'
import { createIpcService, createMainToRendererEmitter, setIpcServiceErrorLogger } from './service'

const electron = vi.hoisted(() => {
  const invokeHandlers = new Map<string, (...args: any[]) => any>()
  const onListeners = new Map<string, (...args: any[]) => void>()

  /** 记录投递的假 WebContents */
  function makeWebContents() {
    const sent: [string, unknown][] = []
    return {
      sent,
      isDestroyed: () => false,
      send: (channel: string, payload: unknown) => void sent.push([channel, payload]),
    }
  }

  /** 假 BrowserWindow，需是真 class：emit 用 instanceof 区分两种投递目标 */
  class FakeBrowserWindow {
    webContents = makeWebContents()
    private destroyed = false
    static instances: FakeBrowserWindow[] = []
    static getAllWindows() {
      return FakeBrowserWindow.instances
    }
    destroy() {
      this.destroyed = true
    }
    isDestroyed() {
      return this.destroyed
    }
  }

  return { invokeHandlers, onListeners, makeWebContents, FakeBrowserWindow }
})

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: any[]) => any) => electron.invokeHandlers.set(channel, fn),
    on: (channel: string, fn: (...args: any[]) => void) => electron.onListeners.set(channel, fn),
  },
  BrowserWindow: electron.FakeBrowserWindow,
}))

type DemoContract = IpcContract<{
  mainHandle: {
    getValue: () => string
  }
  mainOn: {
    seen: (id: string, count: number) => void
    boom: () => void
    boomAsync: () => void
  }
  rendererOn: {
    changed: undefined
  }
}>

/** 只声明 mainHandle 的契约：ServiceImpl 应禁止再传 mainOn */
type OnlyHandleContract = IpcContract<{
  mainHandle: {
    getValue: () => string
  }
}>

/** 模拟 renderer 侧 `ipcRenderer.send` 送达主进程 */
function emulateSend(channel: string, ...args: unknown[]): void {
  const listener = electron.onListeners.get(channel)
  if (!listener) throw new Error(`no ipcMain.on listener for ${channel}`)
  listener({ sender: { id: 42 } }, ...args)
}

describe('createIpcService mainOn 通道', () => {
  let errors: { error: unknown; meta: any }[]

  beforeEach(() => {
    electron.invokeHandlers.clear()
    electron.onListeners.clear()
    electron.FakeBrowserWindow.instances = []
    errors = []
    setIpcServiceErrorLogger((error, meta) => errors.push({ error, meta }))
  })

  it('把 mainOn 注册到 ipcMain.on，并透传参数', () => {
    const seen = vi.fn()
    createIpcService<DemoContract>('demo', {
      mainHandle: {
        async getValue() {
          return 'v'
        },
      },
      mainOn: {
        seen,
        boom() {},
        boomAsync() {},
      },
    })

    expect([...electron.onListeners.keys()]).toContain('demo:seen')
    /** mainHandle 走 handle，不能混进 on */
    expect([...electron.onListeners.keys()]).not.toContain('demo:getValue')

    emulateSend('demo:seen', 'card-1', 3)

    expect(seen).toHaveBeenCalledTimes(1)
    expect(seen.mock.calls[0].slice(1)).toEqual(['card-1', 3])
  })

  it('同步抛错被兜住，不冒泡回 ipcMain，并标记 kind=mainOn', () => {
    createIpcService<DemoContract>('demo', {
      mainHandle: {
        async getValue() {
          return 'v'
        },
      },
      mainOn: {
        seen() {},
        boom() {
          throw new Error('sync-boom')
        },
        boomAsync() {},
      },
    })

    expect(() => emulateSend('demo:boom')).not.toThrow()

    expect(errors).toHaveLength(1)
    expect((errors[0].error as Error).message).toBe('sync-boom')
    expect(errors[0].meta).toMatchObject({
      kind: 'mainOn',
      namespace: 'demo',
      method: 'boom',
      channel: 'demo:boom',
      senderWebContentsId: 42,
    })
  })

  it('async handler 的 rejection 同样被捕获，不漏成 unhandledRejection', async () => {
    createIpcService<DemoContract>('demo', {
      mainHandle: {
        async getValue() {
          return 'v'
        },
      },
      mainOn: {
        seen() {},
        boom() {},
        /** 契约声明为同步，但实现写成 async 是常见情况 */
        boomAsync: (async () => {
          throw new Error('async-boom')
        }) as unknown as () => void,
      },
    })

    emulateSend('demo:boomAsync')

    await vi.waitFor(() => expect(errors).toHaveLength(1))
    expect((errors[0].error as Error).message).toBe('async-boom')
    expect(errors[0].meta.kind).toBe('mainOn')
  })

  it('mainHandle 出错标记 kind=mainHandle，并仍抛回 renderer', async () => {
    createIpcService<OnlyHandleContract>('demo', {
      mainHandle: {
        async getValue() {
          throw new Error('invoke-boom')
        },
      },
    })

    const handler = electron.invokeHandlers.get('demo:getValue')!
    await expect(handler({ sender: { id: 7 } })).rejects.toThrow('invoke-boom')

    expect(errors).toHaveLength(1)
    expect(errors[0].meta).toMatchObject({ kind: 'mainHandle', senderWebContentsId: 7 })
  })

  it('契约无 mainOn 时不注册任何 on 监听（既有服务零影响）', () => {
    createIpcService<OnlyHandleContract>('demo', {
      mainHandle: {
        async getValue() {
          return 'v'
        },
      },
    })

    expect(electron.onListeners.size).toBe(0)
    expect([...electron.invokeHandlers.keys()]).toEqual(['demo:getValue'])
  })
})

/**
 * emit 的投递目标归一化
 *
 * `toWebContents` 是纯运行时分支，typecheck 保证不了。且 channel 拼装是
 * `screenshot` 从裸 `webContents.send(SCREENSHOT_CHANNEL.OK)` 迁过来的前提：
 * 拼错一个字符，renderer 就永远收不到
 */
describe('createIpcService emit 投递', () => {
  beforeEach(() => {
    electron.invokeHandlers.clear()
    electron.onListeners.clear()
    electron.FakeBrowserWindow.instances = []
  })

  it('channel 为 `namespace:event`，与手写常量一致', () => {
    const svc = createIpcService<DemoContract>('screenshot', {
      mainHandle: {
        async getValue() {
          return 'v'
        },
      },
      mainOn: { seen() {}, boom() {}, boomAsync() {} },
    })
    const wc = electron.makeWebContents()

    svc.emit('changed', undefined, wc as any)

    expect(wc.sent[0][0]).toBe('screenshot:changed')
  })

  it('target 传 WebContents 时直接投递给它', () => {
    const svc = createIpcService<OnlyEventsContract>('demo', {})
    const wc = electron.makeWebContents()

    svc.emit('changed', undefined, wc as any)

    expect(wc.sent).toEqual([['demo:changed', undefined]])
  })

  it('target 传 BrowserWindow 时投递给它的 webContents', () => {
    const svc = createIpcService<OnlyEventsContract>('demo', {})
    const win = new electron.FakeBrowserWindow()

    svc.emit('changed', undefined, win as any)

    expect(win.webContents.sent).toEqual([['demo:changed', undefined]])
  })

  it('已销毁的 BrowserWindow 静默跳过，不抛错', () => {
    const svc = createIpcService<OnlyEventsContract>('demo', {})
    const win = new electron.FakeBrowserWindow()
    win.destroy()

    expect(() => svc.emit('changed', undefined, win as any)).not.toThrow()
    expect(win.webContents.sent).toHaveLength(0)
  })

  it('不传 target 时广播到所有未销毁窗口', () => {
    const svc = createIpcService<OnlyEventsContract>('demo', {})
    const alive = new electron.FakeBrowserWindow()
    const dead = new electron.FakeBrowserWindow()
    dead.destroy()
    electron.FakeBrowserWindow.instances = [alive, dead]

    svc.emit('changed', undefined)

    expect(alive.webContents.sent).toEqual([['demo:changed', undefined]])
    expect(dead.webContents.sent).toHaveLength(0)
  })
})

describe('createMainToRendererEmitter 纯推送面', () => {
  beforeEach(() => {
    electron.invokeHandlers.clear()
    electron.onListeners.clear()
    electron.FakeBrowserWindow.instances = []
  })

  it('可投递 rendererOn 事件且不注册任何 main handler', () => {
    const emitter = createMainToRendererEmitter<OnlyEventsContract>('focus')
    const wc = electron.makeWebContents()

    emitter.emit('changed', undefined, wc as any)

    expect(wc.sent).toEqual([['focus:changed', undefined]])
    expect(electron.invokeHandlers.size).toBe(0)
    expect(electron.onListeners.size).toBe(0)
  })
})

/** 只有事件的契约（对应 fn / hold / payment 这类纯推送服务） */
type OnlyEventsContract = IpcContract<{
  rendererOn: {
    changed: undefined
  }
}>
