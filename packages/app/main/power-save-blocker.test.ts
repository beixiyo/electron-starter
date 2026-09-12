import type { WebContents } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  class FakeEventEmitter {
    private listeners = new Map<string, Set<(...args: unknown[]) => void>>()

    on(event: string, listener: (...args: unknown[]) => void): this {
      const listeners = this.listeners.get(event) ?? new Set()
      listeners.add(listener)
      this.listeners.set(event, listeners)
      return this
    }

    once(event: string, listener: (...args: unknown[]) => void): this {
      const wrapped = (...args: unknown[]) => {
        this.removeListener(event, wrapped)
        listener(...args)
      }
      return this.on(event, wrapped)
    }

    emit(event: string, ...args: unknown[]): boolean {
      for (const listener of this.listeners.get(event) ?? [])
        listener(...args)
      return true
    }

    removeListener(event: string, listener: (...args: unknown[]) => void): this {
      this.listeners.get(event)?.delete(listener)
      return this
    }
  }

  const app = new FakeEventEmitter()
  const started = new Set<number>()
  const stopped: number[] = []
  let nextId = 1

  const powerSaveBlocker = {
    start: vi.fn(() => {
      const id = nextId++
      started.add(id)
      return id
    }),
    isStarted: vi.fn((id: number) => started.has(id)),
    stop: vi.fn((id: number) => {
      started.delete(id)
      stopped.push(id)
    }),
  }

  return { app, FakeEventEmitter, powerSaveBlocker, stopped }
})

vi.mock('electron', () => ({
  app: electron.app,
  powerSaveBlocker: electron.powerSaveBlocker,
}))

vi.mock('./logging', () => ({
  createMainDiagnosticLogger: () => ({ debug: vi.fn() }),
}))

import { initPowerSaveBlockers, startActivityPowerSaveBlocker, stopActivityPowerSaveBlocker } from './power-save-blocker'

afterEach(() => {
  electron.app.emit('will-quit')
  electron.stopped.length = 0
})

describe('power save blocker activity lifecycle', () => {
  it('渲染进程消亡时回收其活动声明和阻止器', () => {
    initPowerSaveBlockers()
    const sender = Object.assign(new electron.FakeEventEmitter(), {
      id: 42,
      isDestroyed: () => false,
    })

    const requestId = startActivityPowerSaveBlocker(sender as unknown as WebContents)
    sender.emit('render-process-gone')

    expect(electron.stopped).toEqual([1])

    stopActivityPowerSaveBlocker(requestId)
    expect(electron.stopped).toEqual([1])
  })
})
