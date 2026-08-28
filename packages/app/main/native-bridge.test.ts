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

  it('旧 helper 未确认退出时不启动新代，迟到 exit 后才恢复并重放命令', async () => {
    const handoffComplete = vi.fn()
    const bridge = createBridge({ handoffComplete })

    bridge.start()
    const oldChild = harness.children[0]
    oldChild.kill.mockReturnValue(true)
    const generation = bridge.sendAndBeginHandoff(() => 'stop')
    const restart = bridge.forceRestart(generation)
    const queuedCommand = JSON.stringify({ action: 'start', outputPath: '/tmp/next.m4a' })

    expect(bridge.forceRestart(generation)).toBe(restart)
    expect(bridge.send(queuedCommand)).toBe(true)
    const failedRestart = expect(restart).rejects.toMatchObject({ name: 'NativeHelperExitUnconfirmedError' })

    expect(harness.children).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1_000)
    await failedRestart

    bridge.start()
    expect(harness.children).toHaveLength(1)
    expect(bridge.running).toBe(false)
    expect(bridge.handoffGeneration).toBe(generation)
    expect(handoffComplete).not.toHaveBeenCalled()

    oldChild.emit('exit', null, 'SIGKILL')
    expect(harness.children).toHaveLength(2)
    expect(bridge.running).toBe(true)
    expect(bridge.handoffGeneration).toBeNull()
    expect(handoffComplete).toHaveBeenCalledOnce()
    expect(handoffComplete).toHaveBeenCalledWith(generation)
    expect(harness.children[1].stdin.write).toHaveBeenCalledWith(`${queuedCommand}\n`)
    expect(harness.logger.debug).toHaveBeenCalledWith(
      'process.force-restarted',
      'native helper process force restarted after confirmed exit',
      expect.objectContaining({
        oldPid: oldChild.pid,
        newPid: harness.children[1].pid,
        exitConfirmed: true,
      }),
    )
    expect(vi.getTimerCount()).toBe(0)
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

  it('隔离 helper 使用实际二进制名并可通过 SIGKILL 终止', () => {
    const bridge = new NativeBridge<{ event: string }>({
      name: 'audio-recorder-probe',
      binaryName: 'audio-recorder',
      writable: true,
      parseLine: () => {},
    })

    bridge.start()
    bridge.stop('SIGKILL')

    expect(harness.spawn).toHaveBeenCalledWith(
      expect.stringMatching(/native\/mac\/audio-recorder$/),
      [],
      expect.any(Object),
    )
    expect(harness.children[0].kill).toHaveBeenCalledWith('SIGKILL')
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
