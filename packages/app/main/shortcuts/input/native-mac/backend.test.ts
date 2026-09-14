/**
 * macOS 后端的时间基归一与 helper 缺失时的降级
 *
 * 时间基这条守的是本仓一次真回归：helper 报的是 `ProcessInfo.systemUptime`（开机以来的
 * 毫秒），DOM 后端报的是 `Date.now()`。后端不归一就会让两条路径混进同一个状态机：
 * 录制的跨源去重（差值 > 120ms 永不命中）与 hold 判定（down 取 epoch、up 取 uptime 时
 * elapsed ≈ 1.7e12，轻点一下录成 hold；反向被 `Math.max` 夹成 0，hold 永远录不出来）
 * 用例直接钉住「后端出口必须是 epoch 基」，并把下游症状一起复现出来
 */

import type { KeyboardInput } from '@shared/shortcuts'
import { createShortcutRecordEngine } from '@shared/shortcuts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** helper 在开机约 4.3 天后上报的一条 uptime 时间戳，与 epoch 差了三个数量级 */
const HELPER_UPTIME_MS = 372_157_167

const harness = vi.hoisted(() => ({
  parseLine: null as ((line: string) => void) | null,
  running: false,
  binaryExists: true,
  start: vi.fn(),
  stop: vi.fn(),
  send: vi.fn(),
}))

vi.mock('node:fs', () => ({
  existsSync: () => harness.binaryExists,
}))
vi.mock('@main/permissions', () => ({
  getAppAccessibilityStatus: () => 'granted',
  getKeyboardListenerAccessibilityStatus: () => 'granted',
}))
vi.mock('../../../logging', () => ({
  createMainDiagnosticLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))
vi.mock('../../runtime-sync', () => ({ requestShortcutRuntimeSync: vi.fn() }))
vi.mock('../../../native-bridge', () => ({
  getNativeBinaryPath: (name: string) => `/fake/resources/native/mac/${name}`,
  NativeBridge: class {
    constructor(config: { parseLine: (line: string) => void }) {
      harness.parseLine = config.parseLine
    }

    get running(): boolean {
      return harness.running
    }

    start(): void {
      harness.running = true
      harness.start()
    }

    stop(): void {
      harness.running = false
      harness.stop()
    }

    send(data: string): boolean {
      harness.send(data)
      return true
    }
  },
}))

const { nativeMacKeyboardInputBackend: backend } = await import('./backend')

function inputLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    v: 2,
    type: 'input',
    phase: 'down',
    key: 'Space',
    modifiers: [],
    fn: false,
    timestamp: HELPER_UPTIME_MS,
    ...overrides,
  })
}

describe('macOS 后端时间基归一', () => {
  beforeEach(() => {
    harness.binaryExists = true
    harness.running = false
    harness.start.mockReset()
    harness.stop.mockReset()
    harness.send.mockReset()
  })

  it('helper 的 uptime 时间戳在后端出口变成 epoch 毫秒', () => {
    const received: KeyboardInput[] = []
    const unsubscribe = backend.subscribe(input => received.push(input))

    const before = Date.now()
    harness.parseLine?.(inputLine())
    const after = Date.now()
    unsubscribe()

    const [input] = received
    expect(input).toBeDefined()
    /** 未归一时这里是 372_157_167，与 epoch 差三个数量级 */
    expect(input.timestamp).toBeGreaterThanOrEqual(before)
    expect(input.timestamp).toBeLessThanOrEqual(after)
  })

  it('归一只平移基准，保留 helper 自己的相对间隔', () => {
    const received: KeyboardInput[] = []
    const unsubscribe = backend.subscribe(input => received.push(input))

    harness.parseLine?.(inputLine({ phase: 'down' }))
    harness.parseLine?.(inputLine({ phase: 'up', timestamp: HELPER_UPTIME_MS + 137 }))
    unsubscribe()

    expect(received[1].timestamp - received[0].timestamp).toBe(137)
  })

  /**
   * 下游症状复现：把「IPC 的 down + DOM 的 up」喂给录制状态机
   * 归一前 down 是 uptime、up 是 epoch，elapsed 上千亿毫秒，一次轻点被判成 hold
   */
  it('归一后 IPC 的 down 与 DOM 的 up 不会把轻点判成 hold', () => {
    const received: KeyboardInput[] = []
    const unsubscribe = backend.subscribe(input => received.push(input))
    harness.parseLine?.(inputLine({ phase: 'down', key: 'A' }))
    unsubscribe()

    const detected: Array<{ gesture: string } | null> = []
    const engine = createShortcutRecordEngine({
      onPhaseChange: () => {},
      onDetectedChange: result => detected.push(result && { gesture: result.binding.gesture }),
    })
    engine.start(['press', 'hold'])

    const normalizedDown = received[0]
    engine.handle({
      phase: 'down',
      chord: { source: 'keyboard', key: 'A', modifiers: [] },
      timestamp: normalizedDown.timestamp,
    })
    /** DOM 后端的 up：同一次物理按键，时间戳取 `Date.now()` */
    engine.handle({
      phase: 'up',
      chord: { source: 'keyboard', key: 'A', modifiers: [] },
      timestamp: Date.now(),
    })

    expect(detected.at(-1)).toEqual({ gesture: 'press' })
    engine.dispose()
  })

  /**
   * 坏时间戳不能污染标定
   *
   * helper 被 SIGSTOP 后恢复、系统时钟跳变都可能吐出负数或小数时间戳。偏移是按
   * 「第一条事件」标定的，要是让这种行通过，整代 helper 的时间基都会歪掉。
   * 边界划在 decoder：非负安全整数之外的整行丢弃，`toAppTimeBase` 只见合法值，
   * 于是偏移由第一条**合法**事件标定
   */
  it('第一条是负数或非整数 timestamp 时整行丢弃，不参与标定', async () => {
    /** 偏移是模块级状态，重新加载才能观察「本代第一条事件」的标定 */
    vi.resetModules()
    const { nativeMacKeyboardInputBackend: fresh } = await import('./backend')

    const received: KeyboardInput[] = []
    const unsubscribe = fresh.subscribe(input => received.push(input))

    harness.parseLine?.(inputLine({ timestamp: -1 }))
    harness.parseLine?.(inputLine({ timestamp: 1.5 }))
    expect(received).toHaveLength(0)

    const before = Date.now()
    harness.parseLine?.(inputLine())
    const after = Date.now()
    unsubscribe()

    expect(received).toHaveLength(1)
    expect(received[0].timestamp).toBeGreaterThanOrEqual(before)
    expect(received[0].timestamp).toBeLessThanOrEqual(after)
  })

  /**
   * 🌐 键抑制的期望状态归主进程：helper 启动时恒为不抑制，崩溃换代后不补发的话，
   * 表情面板会在 helper 重启后悄悄回来，而绑定表并没有变、runtime 也不会重算
   */
  it('🌐 键抑制经 stdin 下发，helper 换代后按期望状态补发', async () => {
    vi.resetModules()
    const { nativeMacKeyboardInputBackend: fresh } = await import('./backend')
    const configLine = JSON.stringify({ v: 2, type: 'config', suppressGlobeKey: true })

    /** helper 没在跑：只记状态，不写 */
    fresh.setGlobeKeySuppressed(true)
    expect(harness.send).not.toHaveBeenCalled()

    fresh.acquire()
    expect(harness.send).toHaveBeenCalledWith(configLine)

    /** 同一状态重复设置不再写 */
    fresh.setGlobeKeySuppressed(true)
    expect(harness.send).toHaveBeenCalledTimes(1)

    harness.running = false
    fresh.sync()
    expect(harness.send).toHaveBeenCalledTimes(2)
    expect(harness.send).toHaveBeenLastCalledWith(configLine)

    fresh.setGlobeKeySuppressed(false)
    expect(harness.send).toHaveBeenLastCalledWith(JSON.stringify({ v: 2, type: 'config', suppressGlobeKey: false }))
    fresh.release()
  })

  /** 存在性按进程缓存，所以这里重新加载模块，避免依赖用例顺序 */
  it('helper 二进制缺失时后端判定不可用，且不尝试 spawn', async () => {
    harness.binaryExists = false
    vi.resetModules()
    const { nativeMacKeyboardInputBackend: fresh } = await import('./backend')

    fresh.sync()

    expect(fresh.isAvailable()).toBe(false)
    expect(() => fresh.acquire()).toThrow(/accessibility/i)
    expect(harness.start).not.toHaveBeenCalled()
  })
})
