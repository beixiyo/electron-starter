import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => {
  const listeners = new Map<string, Set<MockListener>>()
  const events: MockEventBus = {
    on(event, listener) {
      const eventListeners = listeners.get(event) ?? new Set()
      eventListeners.add(listener)
      listeners.set(event, eventListeners)
      return () => eventListeners.delete(listener)
    },
    emit(event, payload) {
      listeners.get(event)?.forEach(listener => listener(payload))
    },
    clear() {
      listeners.clear()
    },
  }

  return {
    audioLabSettings: {
      outputChannels: 2 as 1 | 2,
      echoCancellation: 'auto' as 'auto' | 'off',
      delayMode: 'auto' as 'auto' | 'fixed' | 'hybrid',
      fixedDelayMs: 120,
      noiseSuppression: 'off' as 'off' | 'low' | 'moderate' | 'high' | 'very-high',
      gainControl: 'off' as 'off' | 'agc1-adaptive-digital' | 'agc1-fixed' | 'agc2',
      highPass: true,
      meetingDetectionEnabled: true,
    },
    bridge: null as MockBridge | null,
    config: null as MockBridgeConfig | null,
    events,
    execFile: vi.fn(),
    forceRestart: vi.fn<(expectedGeneration?: number) => void>(),
    lastGeneration: null as number | null,
    restartDeferred: null as Deferred | null,
    running: false,
    send: vi.fn<(data: string) => boolean>(() => true),
    start: vi.fn(),
    stop: vi.fn<(signal?: NodeJS.Signals) => void>(),
  }
})

vi.mock('node:child_process', () => ({
  execFile: harness.execFile,
}))

vi.mock('@main/audio-lab/settings', () => ({
  getAudioLabOutputArgs: () => harness.audioLabSettings.outputChannels === 1
    ? ['--mono-output']
    : [],
  getAudioLabSettings: () => ({ ...harness.audioLabSettings }),
}))

vi.mock('../native-bridge', () => ({
  getNativeBinaryPath: () => '/mock/audio-recorder',
  NativeBridge: class {
    private generation = 0
    private readonly pendingHandoffs: number[] = []
    readonly events = harness.events
    handoffGeneration: number | null = null

    constructor(private readonly config: MockBridgeConfig) {
      harness.bridge = this
      harness.config = config
    }

    get pid(): number | null {
      return null
    }

    get running(): boolean {
      return harness.running
    }

    start(): void {
      harness.start()
      harness.running = true
    }

    stop(signal?: NodeJS.Signals): void {
      harness.stop(signal)
      harness.running = false
    }

    send(data: string): boolean {
      return harness.send(data)
    }

    sendAndBeginHandoff(makeData: (generation: number) => string): number {
      const generation = ++this.generation
      makeData(generation)
      harness.lastGeneration = generation
      if (this.handoffGeneration !== null) {
        this.pendingHandoffs.push(generation)
        return generation
      }

      this.handoffGeneration = generation
      this.config.onHandoffStarted?.(generation)
      return generation
    }

    finishHandoff(generation: number): void {
      if (this.handoffGeneration !== generation)
        return

      this.completeActiveHandoff()
    }

    forceRestart(expectedGeneration?: number): Promise<void> {
      harness.forceRestart(expectedGeneration)
      const restart = harness.restartDeferred?.promise ?? Promise.resolve()
      return restart.then(() => {
        if (
          expectedGeneration !== undefined
          && this.handoffGeneration !== expectedGeneration
        ) {
          return
        }

        this.completeActiveHandoff()
      })
    }

    completeHandoffWithoutTerminal(): void {
      this.completeActiveHandoff()
    }

    private completeActiveHandoff(): void {
      const completedGeneration = this.handoffGeneration
      this.handoffGeneration = this.pendingHandoffs.shift() ?? null
      if (this.handoffGeneration !== null)
        this.config.onHandoffStarted?.(this.handoffGeneration)
      this.config.onHandoffComplete?.(completedGeneration)
    }
  },
}))

vi.mock('@main/logging', () => ({
  createMainDiagnosticLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
  },
}))

describe('audio recorder stop handoff', () => {
  let recorder: typeof import('.')

  beforeEach(async () => {
    vi.resetModules()
    vi.useFakeTimers()
    harness.bridge = null
    harness.config = null
    Object.assign(harness.audioLabSettings, {
      outputChannels: 2,
      echoCancellation: 'auto',
      delayMode: 'auto',
      fixedDelayMs: 120,
      noiseSuppression: 'off',
      gainControl: 'off',
      highPass: true,
      meetingDetectionEnabled: true,
    })
    harness.events.clear()
    harness.execFile.mockReset()
    harness.execFile.mockImplementation((...args: unknown[]) => {
      const callback = args.at(-1) as (error: Error | null) => void
      callback(null)
    })
    harness.forceRestart.mockClear()
    harness.lastGeneration = null
    harness.restartDeferred = null
    harness.running = false
    harness.send.mockReset().mockReturnValue(true)
    harness.start.mockClear()
    harness.stop.mockClear()
    recorder = await import('.')
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('helper 异常退出后下一次 start 会先重启再发送命令', () => {
    expect(recorder.startRecording('/tmp/restarted.m4a')).toBe(true)

    expect(harness.start).toHaveBeenCalledOnce()
    expect(harness.send).toHaveBeenCalledOnce()
    expect(JSON.parse(harness.send.mock.calls[0][0])).toMatchObject({
      action: 'start',
      outputPath: '/tmp/restarted.m4a',
    })
  })

  it('mic-only tap 开录也预备 AEC3，系统音热挂后无需重启 helper', () => {
    recorder.startRecording('/tmp/mic-only.m4a', {
      engine: 'tap',
      tapEnabled: false,
      mic: true,
    })

    const command = JSON.parse(harness.send.mock.calls.at(-1)![0])
    expect(command).not.toHaveProperty('micAec')
    expect(command.audioProcessing).toMatchObject({
      processor: 'webrtcAec3',
      noiseSuppression: 'off',
    })
  })

  it('tap 录音显式关闭处理时不被默认配置覆盖', () => {
    recorder.startRecording('/tmp/raw.m4a', {
      engine: 'tap',
      tapEnabled: true,
      mic: true,
      audioProcessing: { processor: 'off' },
    })

    expect(JSON.parse(harness.send.mock.calls.at(-1)![0])).toMatchObject({
      audioProcessing: { processor: 'off' },
    })
  })

  it('tap 默认处理按音频实验设置生成完整 AEC3 配置', () => {
    Object.assign(harness.audioLabSettings, {
      delayMode: 'hybrid',
      fixedDelayMs: 180,
      noiseSuppression: 'high',
      gainControl: 'agc2',
      highPass: false,
    })

    recorder.startRecording('/tmp/lab.m4a', {
      engine: 'tap',
      tapEnabled: true,
      mic: true,
    })

    expect(JSON.parse(harness.send.mock.calls.at(-1)![0])).toMatchObject({
      audioProcessing: {
        processor: 'webrtcAec3',
        delayMode: 'hybrid',
        fixedDelayMs: 180,
        noiseSuppression: 'high',
        gainControl: 'agc2',
        highPass: false,
      },
    })
  })

  it('实验设置关闭回声处理时默认 start 明确下发 off', () => {
    harness.audioLabSettings.echoCancellation = 'off'

    recorder.startRecording('/tmp/lab-off.m4a', {
      engine: 'tap',
      tapEnabled: true,
      mic: true,
    })

    expect(JSON.parse(harness.send.mock.calls.at(-1)![0])).toMatchObject({
      audioProcessing: { processor: 'off' },
    })
  })

  it('tap 录音显式传入 AEC3 配置并保留完整进程选择', () => {
    recorder.startRecording('/tmp/meeting.m4a', {
      engine: 'tap',
      tapEnabled: true,
      pids: [1234],
      excludePids: [5678],
      mic: true,
      audioProcessing: {
        processor: 'webrtcAec3',
        delayMode: 'auto',
        fixedDelayMs: 120,
        noiseSuppression: 'moderate',
        gainControl: 'off',
        highPass: true,
      },
    })

    expect(JSON.parse(harness.send.mock.calls.at(-1)![0])).toMatchObject({
      action: 'start',
      pids: [1234],
      excludePids: [5678],
      audioProcessing: {
        processor: 'webrtcAec3',
        fixedDelayMs: 120,
      },
    })
    expect(JSON.parse(harness.send.mock.calls.at(-1)![0])).not.toHaveProperty('micAec')
  })

  it.each(['completed', 'failed'] as const)(
    'watchdog timeout publishes one routed terminal error after restart %s',
    async (restartOutcome) => {
      const expectedPath = `/tmp/${restartOutcome}.m4a`
      const errorListener = vi.fn()
      const stoppedListener = vi.fn()
      const restart = createDeferred()
      harness.restartDeferred = restart
      recorder.onRecorderEvent('error', errorListener)
      recorder.onRecorderEvent('stopped', stoppedListener)

      recorder.stopRecording(expectedPath)
      const generation = getLastGeneration()
      await vi.advanceTimersByTimeAsync(60_000)

      expect(harness.forceRestart).toHaveBeenCalledOnce()
      expect(harness.forceRestart).toHaveBeenCalledWith(generation)
      expect(errorListener).not.toHaveBeenCalled()

      emitNative({
        status: 'stopped',
        path: expectedPath,
        duration: 12,
        handoffId: generation,
      })
      expect(stoppedListener).not.toHaveBeenCalled()

      if (restartOutcome === 'completed')
        restart.resolve()
      else
        restart.reject(new Error('restart failed'))
      await flushPromises()

      expect(errorListener).toHaveBeenCalledOnce()
      expect(errorListener).toHaveBeenCalledWith({
        code: 'handoff_timeout',
        detail: expect.stringContaining('60000ms'),
        path: expectedPath,
        terminal: true,
      })

      emitNative({
        status: 'stopped',
        path: expectedPath,
        duration: 12,
        handoffId: generation,
      })
      expect(stoppedListener).not.toHaveBeenCalled()
      expect(errorListener).toHaveBeenCalledOnce()
    },
  )

  it.each([false, true])(
    'normal terminal clears watchdog (recycle=%s)',
    async (requiresRecycle) => {
      const expectedPath = `/tmp/normal-${requiresRecycle}.m4a`
      const errorListener = vi.fn()
      const stoppedListener = vi.fn()
      recorder.onRecorderEvent('error', errorListener)
      recorder.onRecorderEvent('stopped', stoppedListener)

      recorder.stopRecording(expectedPath)
      const generation = getLastGeneration()
      if (requiresRecycle) {
        emitNative({
          status: 'recycle_required',
          handoffId: generation,
        })
      }
      emitNative({
        status: 'stopped',
        path: expectedPath,
        duration: 8,
        handoffId: generation,
      })
      await flushPromises()

      expect(stoppedListener).toHaveBeenCalledOnce()
      expect(stoppedListener).toHaveBeenCalledWith({
        path: expectedPath,
        duration: 8,
      })
      expect(errorListener).not.toHaveBeenCalled()
      expect(harness.forceRestart).toHaveBeenCalledTimes(requiresRecycle
        ? 1
        : 0)

      await vi.advanceTimersByTimeAsync(60_000)
      expect(errorListener).not.toHaveBeenCalled()
      expect(harness.forceRestart).toHaveBeenCalledTimes(requiresRecycle
        ? 1
        : 0)
    },
  )

  it('publishes stopped only after a fresh helper validates the final output', async () => {
    const expectedPath = '/tmp/validated.m4a'
    const stoppedListener = vi.fn()
    recorder.onRecorderEvent('stopped', stoppedListener)

    recorder.stopRecording(expectedPath)
    emitNative({
      status: 'stopped',
      path: expectedPath,
      duration: 9,
      handoffId: getLastGeneration(),
    })
    await flushPromises()

    expect(harness.execFile).toHaveBeenCalledWith(
      '/mock/audio-recorder',
      ['--validate-audio', expectedPath],
      { timeout: 30_000 },
      expect.any(Function),
    )
    expect(stoppedListener).toHaveBeenCalledOnce()
    expect(stoppedListener).toHaveBeenCalledWith({ path: expectedPath, duration: 9 })
  })

  it('publishes terminal writer_failed and preserves recovery ownership when validation fails', async () => {
    const expectedPath = '/tmp/corrupt.m4a'
    const stoppedListener = vi.fn()
    const errorListener = vi.fn()
    harness.execFile.mockImplementationOnce((...args: unknown[]) => {
      const callback = args.at(-1) as (error: Error | null) => void
      callback(new Error('cannot decode'))
    })
    recorder.onRecorderEvent('stopped', stoppedListener)
    recorder.onRecorderEvent('error', errorListener)

    recorder.stopRecording(expectedPath)
    emitNative({
      status: 'stopped',
      path: expectedPath,
      duration: 9,
      handoffId: getLastGeneration(),
    })
    await flushPromises()

    expect(stoppedListener).not.toHaveBeenCalled()
    expect(errorListener).toHaveBeenCalledOnce()
    expect(errorListener).toHaveBeenCalledWith({
      code: 'writer_failed',
      detail: expect.stringContaining('recovery assets were preserved'),
      path: expectedPath,
      terminal: true,
    })
  })

  it('same-generation terminal with the wrong path keeps the watchdog armed', async () => {
    const expectedPath = '/tmp/current.m4a'
    const errorListener = vi.fn()
    const stoppedListener = vi.fn()
    recorder.onRecorderEvent('error', errorListener)
    recorder.onRecorderEvent('stopped', stoppedListener)

    recorder.stopRecording(expectedPath)
    const generation = getLastGeneration()
    emitNative({
      error: 'not_recording',
      detail: 'stale coordinator output',
      path: '/tmp/stale.m4a',
      terminal: true,
      handoffId: generation,
    })

    expect(errorListener).not.toHaveBeenCalled()
    expect(stoppedListener).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(harness.forceRestart).toHaveBeenCalledWith(generation)
    expect(errorListener).toHaveBeenCalledOnce()
    expect(errorListener).toHaveBeenCalledWith({
      code: 'handoff_timeout',
      detail: expect.stringContaining('60000ms'),
      path: expectedPath,
      terminal: true,
    })
  })

  it('terminal error without a path keeps the watchdog armed', async () => {
    const expectedPath = '/tmp/malformed-terminal.m4a'
    const errorListener = vi.fn()
    recorder.onRecorderEvent('error', errorListener)

    recorder.stopRecording(expectedPath)
    const generation = getLastGeneration()
    emitNative({
      error: 'writer_failed',
      terminal: true,
      handoffId: generation,
    })

    expect(errorListener).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(harness.forceRestart).toHaveBeenCalledWith(generation)
    expect(errorListener).toHaveBeenCalledOnce()
    expect(errorListener).toHaveBeenCalledWith(expect.objectContaining({
      code: 'handoff_timeout',
      path: expectedPath,
      terminal: true,
    }))
  })

  it('terminal without a handoff id cannot settle the active generation', async () => {
    const expectedPath = '/tmp/missing-handoff-id.m4a'
    const errorListener = vi.fn()
    const stoppedListener = vi.fn()
    recorder.onRecorderEvent('error', errorListener)
    recorder.onRecorderEvent('stopped', stoppedListener)

    recorder.stopRecording(expectedPath)
    const generation = getLastGeneration()
    emitNative({
      status: 'stopped',
      path: expectedPath,
      duration: 7,
    })

    expect(errorListener).not.toHaveBeenCalled()
    expect(stoppedListener).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(harness.forceRestart).toHaveBeenCalledWith(generation)
    expect(errorListener).toHaveBeenCalledOnce()
    expect(errorListener).toHaveBeenCalledWith(expect.objectContaining({
      code: 'handoff_timeout',
      path: expectedPath,
      terminal: true,
    }))
  })

  it('queued handoffs retain their own expected output paths', async () => {
    const firstPath = '/tmp/first.m4a'
    const secondPath = '/tmp/second.m4a'
    const errorListener = vi.fn()
    const stoppedListener = vi.fn()
    recorder.onRecorderEvent('error', errorListener)
    recorder.onRecorderEvent('stopped', stoppedListener)

    recorder.stopRecording(firstPath)
    const firstGeneration = getLastGeneration()
    recorder.stopRecording(secondPath)
    const secondGeneration = getLastGeneration()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(errorListener).toHaveBeenCalledOnce()
    expect(errorListener).toHaveBeenCalledWith(expect.objectContaining({
      code: 'handoff_timeout',
      path: firstPath,
    }))

    emitNative({
      status: 'stopped',
      path: firstPath,
      duration: 5,
      handoffId: firstGeneration,
    })
    emitNative({
      status: 'stopped',
      path: secondPath,
      duration: 6,
      handoffId: secondGeneration,
    })
    await flushPromises()

    expect(stoppedListener).toHaveBeenCalledOnce()
    expect(stoppedListener).toHaveBeenCalledWith({
      path: secondPath,
      duration: 6,
    })
    expect(errorListener).toHaveBeenCalledOnce()
  })

  it('helper exit during handoff publishes one interrupted terminal error', async () => {
    const expectedPath = '/tmp/interrupted.m4a'
    const errorListener = vi.fn()
    const stoppedListener = vi.fn()
    recorder.onRecorderEvent('error', errorListener)
    recorder.onRecorderEvent('stopped', stoppedListener)

    recorder.stopRecording(expectedPath)
    const generation = getLastGeneration()
    const bridge = harness.bridge
    if (!bridge)
      throw new Error('mock bridge was not initialized')
    bridge.completeHandoffWithoutTerminal()

    expect(errorListener).toHaveBeenCalledOnce()
    expect(errorListener).toHaveBeenCalledWith({
      code: 'handoff_interrupted',
      detail: expect.stringContaining('recovery assets were preserved'),
      path: expectedPath,
      terminal: true,
    })

    emitNative({
      status: 'stopped',
      path: expectedPath,
      duration: 4,
      handoffId: generation,
    })
    await vi.advanceTimersByTimeAsync(60_000)

    expect(stoppedListener).not.toHaveBeenCalled()
    expect(errorListener).toHaveBeenCalledOnce()
    expect(harness.forceRestart).not.toHaveBeenCalled()
  })

  it('启动预检成功后把 raw/capture 策略作为正式 tap 录音提示，并强制回收隔离 helper', async () => {
    const probe = recorder.probeMicCaptureStrategy()
    expect(JSON.parse(harness.send.mock.calls.at(-1)![0])).toEqual({ action: 'probeMic' })

    emitNative({
      status: 'mic_probe_complete',
      micStrategy: 'rawAudioEngine',
      micDeviceKey: 'device-key',
    })
    await expect(probe).resolves.toMatchObject({ ready: true })
    expect(harness.stop).toHaveBeenCalledWith('SIGKILL')

    recorder.startRecording('/tmp/cached.m4a', { engine: 'tap', mic: true })
    expect(JSON.parse(harness.send.mock.calls.at(-1)![0])).toEqual(expect.objectContaining({
      preferredMicStrategy: 'rawAudioEngine',
      preferredMicDeviceKey: 'device-key',
    }))
  })

  it('启动预检只透传 raw/capture 路线，不包含 VPIO 状态', async () => {
    const probe = recorder.probeMicCaptureStrategy()

    emitNative({
      status: 'mic_probe_complete',
      micStrategy: 'rawAudioEngine',
      micDeviceKey: 'device-key',
    })

    await expect(probe).resolves.toEqual({
      ready: true,
      strategy: 'rawAudioEngine',
    })
  })

  /**
   * mic_route_changed 覆盖「重挂成功但换了路线」这类静默降级——mic_degraded 只在重挂
   * 彻底失败时发出，覆盖不到。字段一旦在转发时被丢弃，事后就只能靠猜
   */
  it('录音中途换麦克风路线时透传原因与路线，并作废旧路线提示', () => {
    /** 先让正式录音留下一条缓存路线提示 */
    emitNative({
      status: 'recording',
      path: '/tmp/running.m4a',
      micStrategy: 'rawAudioEngine',
      micDeviceKey: 'device-key',
    })

    const routeChanged = vi.fn()
    recorder.onRecorderEvent('mic_route_changed', routeChanged)
    emitNative({
      status: 'mic_route_changed',
      reason: 'default-input-changed',
      micStrategy: 'rawAudioEngine',
    })

    expect(routeChanged).toHaveBeenCalledWith({
      reason: 'default-input-changed',
      micStrategy: 'rawAudioEngine',
    })

    /** 重挂已重新探测过路线，旧提示不能再拿去加速下一场 */
    recorder.startRecording('/tmp/after-route-change.m4a', { engine: 'tap', mic: true })
    expect(JSON.parse(harness.send.mock.calls.at(-1)![0])).not.toEqual(expect.objectContaining({
      preferredMicStrategy: expect.anything(),
    }))
  })

  /**
   * 实测形态：tap 在 start 阶段挂载成功（否则整场录音会直接报错），却全程 0 回调，
   * 成品只剩麦克风轨。首样本看门狗的条件是两轨样本合计为 0，mic 正常时不触发，
   * 只能靠这几个字段发现
   */
  it('停止时透传系统音轨采集统计，可区分「没出数据」与「全被丢弃」', async () => {
    const expectedPath = '/tmp/empty-system.m4a'
    const stopped = vi.fn()
    recorder.onRecorderEvent('stopped', stopped)

    recorder.stopRecording(expectedPath)
    emitNative({
      status: 'stopped',
      path: expectedPath,
      duration: 34.9,
      handoffId: getLastGeneration(),
      systemAudioRequested: true,
      systemAudioAppends: 0,
      systemAudioCallbacks: 0,
      systemAudioDrops: 0,
      micAppends: 349,
    })
    await flushPromises()

    expect(stopped).toHaveBeenCalledWith(expect.objectContaining({
      systemAudioRequested: true,
      systemAudioAppends: 0,
      systemAudioCallbacks: 0,
      micAppends: 349,
    }))
  })

  it('启动预检明确失败时立即结束并回收隔离 helper', async () => {
    const probe = recorder.probeMicCaptureStrategy()

    emitNative({ status: 'mic_probe_failed', detail: 'no_capture_source' })

    await expect(probe).resolves.toEqual({ ready: false })
    expect(harness.stop).toHaveBeenCalledWith('SIGKILL')
  })
})

function createDeferred(): Deferred {
  let resolve!: () => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function emitNative(message: Record<string, unknown>): void {
  const config = harness.config
  if (!config)
    throw new Error('mock bridge config was not captured')
  config.parseLine(JSON.stringify(message), harness.events)
}

function getLastGeneration(): number {
  const generation = harness.lastGeneration
  if (generation === null)
    throw new Error('stop handoff generation was not created')
  return generation
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

type MockListener = (payload: unknown) => void

type MockEventBus = {
  on: (event: string, listener: MockListener) => () => void
  emit: (event: string, payload: unknown) => void
  clear: () => void
}

type MockBridgeConfig = {
  onHandoffComplete?: (generation: number | null) => void
  onHandoffStarted?: (generation: number) => void
  parseLine: (line: string, bus: MockEventBus) => void
}

type MockBridge = {
  handoffGeneration: number | null
  completeHandoffWithoutTerminal: () => void
}

type Deferred = {
  promise: Promise<void>
  resolve: () => void
  reject: (reason: unknown) => void
}
