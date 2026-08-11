import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NativeBridge } from './native-bridge'

const harness = vi.hoisted(() => ({
  children: [] as FakeChild[],
  spawn: vi.fn(),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('node:child_process', () => ({
  spawn: harness.spawn,
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
  },
}))

vi.mock('./logging', () => ({
  createMainDiagnosticLogger: () => harness.logger,
}))

describe('native bridge 重启生命周期', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.restoreAllMocks()
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    harness.children.length = 0
    harness.spawn.mockImplementation(() => {
      const child = createChild(harness.children.length + 1)
      harness.children.push(child)
      return child
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('handoff 中收到 error 会像 exit 一样完成重启', async () => {
    const unexpectedExit = vi.fn()
    const handoffComplete = vi.fn()
    const bridge = createBridge({ unexpectedExit, handoffComplete })

    bridge.start()
    const oldChild = harness.children[0]
    const generation = bridge.sendAndBeginHandoff(() => 'stop')

    oldChild.emit('error', new Error('helper failed during stop'))
    await Promise.resolve()

    expect(harness.children).toHaveLength(2)
    expect(bridge.running).toBe(true)
    expect(bridge.handoffGeneration).toBeNull()
    expect(handoffComplete).toHaveBeenCalledOnce()
    expect(handoffComplete).toHaveBeenCalledWith(generation)
    expect(unexpectedExit).not.toHaveBeenCalled()
  })

  it('建立 handoff 前会把 stop 命令真实写入当前 helper stdin', () => {
    const bridge = createBridge()

    bridge.start()
    const child = harness.children[0]
    const generation = bridge.sendAndBeginHandoff(handoffId => JSON.stringify({
      action: 'stop',
      handoffId,
    }))

    expect(child.stdin.write).toHaveBeenCalledWith(`{"action":"stop","handoffId":${generation}}\n`)
    expect(bridge.handoffGeneration).toBe(generation)
  })

  it('force restart 在 SIGKILL 成功但没有 exit 事件时由短 watchdog 完成重启', async () => {
    const handoffComplete = vi.fn()
    const bridge = createBridge({ handoffComplete })

    bridge.start()
    const oldChild = harness.children[0]
    oldChild.kill.mockReturnValue(true)
    const generation = bridge.sendAndBeginHandoff(() => 'stop')
    const restart = bridge.forceRestart(generation)

    expect(harness.children).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1_000)
    await restart

    expect(harness.children).toHaveLength(2)
    expect(bridge.running).toBe(true)
    expect(bridge.handoffGeneration).toBeNull()
    expect(handoffComplete).toHaveBeenCalledOnce()
    expect(handoffComplete).toHaveBeenCalledWith(generation)
    expect(vi.getTimerCount()).toBe(0)

    oldChild.emit('exit', null, 'SIGKILL')
    expect(harness.children).toHaveLength(2)
    expect(handoffComplete).toHaveBeenCalledOnce()
  })

  it('handoff 中的正常 exit 只启动一代新进程，不会重复重启', async () => {
    const handoffComplete = vi.fn()
    const unexpectedExit = vi.fn()
    const bridge = createBridge({ handoffComplete, unexpectedExit })

    bridge.start()
    const oldChild = harness.children[0]
    const generation = bridge.sendAndBeginHandoff(() => 'stop')

    oldChild.emit('exit', 0, null)
    await Promise.resolve()
    oldChild.emit('exit', 0, null)
    await Promise.resolve()

    expect(harness.children).toHaveLength(2)
    expect(bridge.running).toBe(true)
    expect(bridge.handoffGeneration).toBeNull()
    expect(handoffComplete).toHaveBeenCalledOnce()
    expect(handoffComplete).toHaveBeenCalledWith(generation)
    expect(vi.getTimerCount()).toBe(0)
    expect(unexpectedExit).not.toHaveBeenCalled()
  })
})

function createBridge(options: {
  handoffComplete?: () => void
  unexpectedExit?: (code: number | null, signal: NodeJS.Signals | null) => void
} = {}): NativeBridge<{ event: string }> {
  return new NativeBridge({
    name: 'test-helper',
    onHandoffComplete: options.handoffComplete,
    onUnexpectedExit: options.unexpectedExit,
    parseLine: () => {},
  })
}

function createChild(pid: number): FakeChild {
  const child = new EventEmitter() as FakeChild
  child.pid = pid
  child.stdin = createStream()
  child.stdout = createStream()
  child.stderr = createStream()
  child.kill = vi.fn(() => true)
  return child
}

function createStream(): FakeStream {
  const stream = new EventEmitter() as FakeStream
  stream.writable = true
  stream.setEncoding = vi.fn()
  stream.write = vi.fn()
  return stream
}

type FakeStream = EventEmitter & {
  writable: boolean
  setEncoding: ReturnType<typeof vi.fn>
  write: ReturnType<typeof vi.fn>
}

type FakeChild = EventEmitter & {
  pid: number
  stdin: FakeStream
  stdout: FakeStream
  stderr: FakeStream
  kill: ReturnType<typeof vi.fn>
}
