import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  execFile: vi.fn(),
  recoveryDir: '',
}))

vi.mock('node:child_process', () => ({
  execFile: harness.execFile,
}))

vi.mock('@main/audio-lab/settings', () => ({
  getAudioLabOutputArgs: () => [],
}))

vi.mock('@main/native-bridge', () => ({
  getNativeBinaryPath: () => '/mock/audio-recorder',
}))

vi.mock('@main/storage', () => ({
  getAppStorageAreaPath: () => harness.recoveryDir,
}))

const TASK_ID = '00000000-0000-4000-8000-000000000001'

describe('录音资产恢复扫描', () => {
  let recovery: typeof import('.')

  beforeEach(async () => {
    harness.recoveryDir = await mkdtemp(join(tmpdir(), 'recording-recovery-'))
    harness.execFile.mockReset()
    vi.resetModules()
    recovery = await import('.')
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(harness.recoveryDir, { recursive: true, force: true })
  })

  it('mic sidecar 恢复失败时不暴露非零主文件，保留资产供下次扫描重试', async () => {
    const paths = await createRecoveryAssets({ micSidecar: true })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockRecoveryCommandFailure()

    await expect(recovery.listRecoverableRecordings()).resolves.toEqual([])
    await expect(readFile(paths.outputPath, 'utf-8')).resolves.toBe('main audio')
    await expect(readFile(paths.sidecarPath, 'utf-8')).resolves.toBe('mic audio')
    await expect(access(paths.manifestPath)).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledOnce()

    mockRecoveryCommandSuccess()
    mockRecoveryCommandSuccess()

    await expect(recovery.listRecoverableRecordings()).resolves.toEqual([
      expect.objectContaining({
        taskId: TASK_ID,
        path: paths.outputPath,
        fileSize: Buffer.byteLength('main audio'),
      }),
    ])
    expect(harness.execFile).toHaveBeenCalledTimes(3)
  })

  it('checkpoint 合并失败时不继续恢复 sidecar，也不暴露或删除任何资产', async () => {
    const paths = await createRecoveryAssets({ checkpoint: true, micSidecar: true })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockRecoveryCommandFailure()

    await expect(recovery.listRecoverableRecordings()).resolves.toEqual([])
    expect(harness.execFile).toHaveBeenCalledOnce()
    expect(harness.execFile.mock.calls[0]?.[1]).toEqual([
      '--merge-checkpoints',
      paths.checkpointPath,
      paths.outputPath,
    ])
    await expect(access(paths.checkpointPath)).resolves.toBeUndefined()
    await expect(access(paths.sidecarPath)).resolves.toBeUndefined()
    await expect(access(paths.outputPath)).resolves.toBeUndefined()
    await expect(access(paths.manifestPath)).resolves.toBeUndefined()
  })

  it('空 checkpoint 目录不执行 merge，继续恢复 sidecar 并暴露结果', async () => {
    const paths = await createRecoveryAssets({ emptyCheckpoint: true, micSidecar: true })
    mockRecoveryCommandSuccess()
    mockRecoveryCommandSuccess()

    await expect(recovery.listRecoverableRecordings()).resolves.toEqual([
      expect.objectContaining({
        taskId: TASK_ID,
        path: paths.outputPath,
      }),
    ])
    expect(harness.execFile.mock.calls.map(call => call[1])).toEqual([
      ['--recover-mic-sidecar', paths.sidecarPath, paths.outputPath],
      ['--validate-audio', paths.outputPath],
    ])
  })

  it('没有 checkpoint 和 sidecar 时通过原生媒体校验后暴露主文件', async () => {
    const paths = await createRecoveryAssets({})
    mockRecoveryCommandSuccess()

    await expect(recovery.listRecoverableRecordings()).resolves.toEqual([
      expect.objectContaining({
        taskId: TASK_ID,
        path: paths.outputPath,
      }),
    ])
    expect(harness.execFile).toHaveBeenCalledOnce()
    expect(harness.execFile.mock.calls[0]?.[1]).toEqual([
      '--validate-audio',
      paths.outputPath,
    ])
  })

  it('非活跃实时交付临时件会被删除且不进入恢复校验', async () => {
    const realtimeTemp = join(harness.recoveryDir, `_realtime_${TASK_ID}.m4a`)
    await writeFile(realtimeTemp, 'partial realtime m4a')

    await expect(recovery.listRecoverableRecordings()).resolves.toEqual([])
    await expect(access(realtimeTemp)).rejects.toThrow()
    expect(harness.execFile).not.toHaveBeenCalled()
  })

  it('当前录音的实时交付临时件不会被恢复扫描删除', async () => {
    const outputPath = join(harness.recoveryDir, `${TASK_ID}.m4a`)
    const realtimeTemp = join(harness.recoveryDir, `_realtime_${TASK_ID}.m4a`)
    await writeFile(realtimeTemp, 'active realtime m4a')

    await expect(recovery.listRecoverableRecordings(outputPath)).resolves.toEqual([])
    await expect(readFile(realtimeTemp, 'utf-8')).resolves.toBe('active realtime m4a')
    expect(harness.execFile).not.toHaveBeenCalled()
  })

  it('原生媒体校验失败时不暴露或删除非零文件', async () => {
    const paths = await createRecoveryAssets({})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockRecoveryCommandFailure()

    await expect(recovery.listRecoverableRecordings()).resolves.toEqual([])
    await expect(readFile(paths.outputPath, 'utf-8')).resolves.toBe('main audio')
    await expect(access(paths.manifestPath)).resolves.toBeUndefined()
  })

  it('已有 sidecar 事务时优先恢复事务，不让 checkpoint 覆盖已混音主文件', async () => {
    const paths = await createRecoveryAssets({ checkpoint: true, micSidecar: true, micTransaction: true })
    mockRecoveryCommandSuccess()
    mockRecoveryCommandSuccess()

    await expect(recovery.listRecoverableRecordings()).resolves.toEqual([
      expect.objectContaining({
        taskId: TASK_ID,
        path: paths.outputPath,
      }),
    ])
    expect(harness.execFile.mock.calls.map(call => call[1])).toEqual([
      ['--recover-mic-sidecar', paths.sidecarPath, paths.outputPath],
      ['--validate-audio', paths.outputPath],
    ])
  })

  it('sidecar 事务恢复失败时保留 marker、backup、checkpoint 和 sidecar', async () => {
    const paths = await createRecoveryAssets({ checkpoint: true, micSidecar: true, micTransaction: true })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockRecoveryCommandFailure()

    await expect(recovery.listRecoverableRecordings()).resolves.toEqual([])
    await expect(access(paths.sidecarPath)).resolves.toBeUndefined()
    await expect(access(paths.backupPath)).resolves.toBeUndefined()
    await expect(access(paths.pendingPath)).resolves.toBeUndefined()
    await expect(access(paths.lockPath)).resolves.toBeUndefined()
    await expect(access(paths.checkpointPath)).resolves.toBeUndefined()
  })

  it('sidecar 已删除但事务资产还在时仍调用 helper 确认提交状态', async () => {
    const paths = await createRecoveryAssets({ micTransaction: true })
    mockRecoveryCommandSuccess()
    mockRecoveryCommandSuccess()

    await expect(recovery.listRecoverableRecordings()).resolves.toEqual([
      expect.objectContaining({ taskId: TASK_ID }),
    ])
    expect(harness.execFile.mock.calls.map(call => call[1])).toEqual([
      ['--recover-mic-sidecar', paths.sidecarPath, paths.outputPath],
      ['--validate-audio', paths.outputPath],
    ])
  })

  it('仅剩 pending marker 时仍能发现任务并尝试恢复', async () => {
    const paths = await createRecoveryAssets({ micTransaction: true })
    await Promise.all([
      rm(paths.outputPath),
      rm(paths.manifestPath),
      rm(paths.backupPath),
    ])
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockRecoveryCommandFailure()

    await expect(recovery.listRecoverableRecordings()).resolves.toEqual([])
    expect(harness.execFile).toHaveBeenCalledOnce()
    expect(harness.execFile.mock.calls[0]?.[1]).toEqual([
      '--recover-mic-sidecar',
      paths.sidecarPath,
      paths.outputPath,
    ])
  })

  it('删除恢复任务时同时清理 sidecar 事务资产', async () => {
    const paths = await createRecoveryAssets({ micSidecar: true, micTransaction: true })

    await recovery.deleteRecoveryRecording(TASK_ID)

    await expect(access(paths.outputPath)).rejects.toThrow()
    await expect(access(paths.sidecarPath)).rejects.toThrow()
    await expect(access(paths.backupPath)).rejects.toThrow()
    await expect(access(paths.pendingPath)).rejects.toThrow()
    await expect(access(paths.manifestPath)).rejects.toThrow()
    await expect(access(paths.lockPath)).resolves.toBeUndefined()
  })

  it('仅有 stale lock 且主文件可读时不阻塞暴露，也不重复恢复 sidecar', async () => {
    const paths = await createRecoveryAssets({})
    await writeFile(paths.lockPath, 'stale helper lock')
    mockRecoveryCommandSuccess()

    await expect(recovery.listRecoverableRecordings()).resolves.toEqual([
      expect.objectContaining({
        taskId: TASK_ID,
        path: paths.outputPath,
      }),
    ])
    expect(harness.execFile.mock.calls.map(call => call[1])).toEqual([
      ['--validate-audio', paths.outputPath],
    ])
    await expect(access(paths.lockPath)).resolves.toBeUndefined()
  })

  it('同一 taskId 并发扫描时只运行一套 native 恢复和校验命令', async () => {
    const paths = await createRecoveryAssets({ micSidecar: true })
    const callbacks: Array<(error: Error | null) => void> = []
    harness.execFile.mockImplementation((...args: unknown[]) => {
      callbacks.push(args.at(-1) as (error: Error | null) => void)
    })

    const first = recovery.listRecoverableRecordings()
    const second = recovery.listRecoverableRecordings()
    await vi.waitFor(() => expect(harness.execFile).toHaveBeenCalledTimes(1))
    callbacks.shift()?.(null)
    await vi.waitFor(() => expect(harness.execFile).toHaveBeenCalledTimes(2))
    callbacks.shift()?.(null)

    await expect(Promise.all([first, second])).resolves.toEqual([
      [expect.objectContaining({ taskId: TASK_ID, path: paths.outputPath })],
      [expect.objectContaining({ taskId: TASK_ID, path: paths.outputPath })],
    ])
    expect(harness.execFile.mock.calls.map(call => call[1])).toEqual([
      ['--recover-mic-sidecar', paths.sidecarPath, paths.outputPath],
      ['--validate-audio', paths.outputPath],
    ])
  })

  it('删除任务会等待同 taskId 的恢复结束，但不会删除 stale lock', async () => {
    const paths = await createRecoveryAssets({ micSidecar: true, micTransaction: true })
    const callbacks: Array<(error: Error | null) => void> = []
    harness.execFile.mockImplementation((...args: unknown[]) => {
      callbacks.push(args.at(-1) as (error: Error | null) => void)
    })

    const scan = recovery.listRecoverableRecordings()
    await vi.waitFor(() => expect(harness.execFile).toHaveBeenCalledTimes(1))
    const deletion = recovery.deleteRecoveryRecording(TASK_ID)
    await Promise.resolve()
    await expect(access(paths.outputPath)).resolves.toBeUndefined()

    callbacks.shift()?.(null)
    await vi.waitFor(() => expect(harness.execFile).toHaveBeenCalledTimes(2))
    callbacks.shift()?.(null)
    await deletion
    await scan

    await expect(access(paths.outputPath)).rejects.toThrow()
    await expect(access(paths.lockPath)).resolves.toBeUndefined()
  })

  it('未提交 sidecar 事务回滚后同次扫描先重建 checkpoint 再混入 sidecar', async () => {
    const paths = await createRecoveryAssets({ checkpoint: true, micSidecar: true, micTransaction: true })
    const callbacks: Array<(error: Error | null) => void> = []
    harness.execFile.mockImplementation((...args: unknown[]) => {
      callbacks.push(args.at(-1) as (error: Error | null) => void)
    })

    const scan = recovery.listRecoverableRecordings()
    await vi.waitFor(() => expect(harness.execFile).toHaveBeenCalledTimes(1))
    expect(harness.execFile.mock.calls[0]?.[1]).toEqual([
      '--recover-mic-sidecar',
      paths.sidecarPath,
      paths.outputPath,
    ])

    /** 模拟 helper 证明 output 未提交后撤销 marker/backup，再以失败码请求 checkpoint 兜底 */
    await Promise.all([rm(paths.backupPath), rm(paths.pendingPath)])
    callbacks.shift()?.(Object.assign(new Error('primary unreadable'), { code: 1 }))
    await vi.waitFor(() => expect(harness.execFile).toHaveBeenCalledTimes(2))
    callbacks.shift()?.(null)
    await vi.waitFor(() => expect(harness.execFile).toHaveBeenCalledTimes(3))
    callbacks.shift()?.(null)
    await vi.waitFor(() => expect(harness.execFile).toHaveBeenCalledTimes(4))
    callbacks.shift()?.(null)

    await expect(scan).resolves.toEqual([
      expect.objectContaining({ taskId: TASK_ID, path: paths.outputPath }),
    ])
    expect(harness.execFile.mock.calls.map(call => call[1])).toEqual([
      ['--recover-mic-sidecar', paths.sidecarPath, paths.outputPath],
      ['--merge-checkpoints', paths.checkpointPath, paths.outputPath],
      ['--recover-mic-sidecar', paths.sidecarPath, paths.outputPath],
      ['--validate-audio', paths.outputPath],
    ])
  })

  it('activeOutputPath 匹配时跳过任务且不触发 native helper', async () => {
    const paths = await createRecoveryAssets({ checkpoint: true, micSidecar: true })

    await expect(recovery.listRecoverableRecordings(paths.outputPath)).resolves.toEqual([])
    expect(harness.execFile).not.toHaveBeenCalled()
  })
})

async function createRecoveryAssets(options: {
  checkpoint?: boolean
  emptyCheckpoint?: boolean
  micSidecar?: boolean
  micTransaction?: boolean
}): Promise<RecoveryAssetPaths> {
  const paths = getRecoveryAssetPaths()

  await writeFile(paths.outputPath, 'main audio')
  await writeFile(paths.manifestPath, JSON.stringify({
    taskId: TASK_ID,
    source: 'manual',
    mimeType: 'audio/mp4',
    createdAt: 1,
    micAudio: true,
    systemAudio: false,
  }))

  if (options.checkpoint || options.emptyCheckpoint)
    await mkdir(paths.checkpointPath)

  if (options.checkpoint)
    await writeFile(join(paths.checkpointPath, '000001.m4a'), 'checkpoint audio')
  if (options.micSidecar)
    await writeFile(paths.sidecarPath, 'mic audio')
  if (options.micTransaction) {
    await writeFile(paths.backupPath, 'main audio')
    await writeFile(paths.pendingPath, '{"version":1}')
    await writeFile(paths.lockPath, 'stale helper lock')
  }

  return paths
}

function getRecoveryAssetPaths(): RecoveryAssetPaths {
  return {
    outputPath: join(harness.recoveryDir, `${TASK_ID}.m4a`),
    manifestPath: join(harness.recoveryDir, `${TASK_ID}.json`),
    sidecarPath: join(harness.recoveryDir, `${TASK_ID}.mic.caf`),
    backupPath: join(harness.recoveryDir, `${TASK_ID}.m4a.mic-backup`),
    pendingPath: join(harness.recoveryDir, `${TASK_ID}.m4a.mic-pending`),
    lockPath: join(harness.recoveryDir, `${TASK_ID}.m4a.mic-lock`),
    checkpointPath: join(harness.recoveryDir, `${TASK_ID}.m4a.segments`),
  }
}

function mockRecoveryCommandFailure(): void {
  harness.execFile.mockImplementationOnce((...args: unknown[]) => {
    const callback = args.at(-1) as (error: Error | null) => void
    callback(Object.assign(new Error('helper exited with status 1'), { code: 1 }))
  })
}

function mockRecoveryCommandSuccess(): void {
  harness.execFile.mockImplementationOnce((...args: unknown[]) => {
    const callback = args.at(-1) as (error: Error | null) => void
    callback(null)
  })
}

type RecoveryAssetPaths = {
  outputPath: string
  manifestPath: string
  sidecarPath: string
  backupPath: string
  pendingPath: string
  lockPath: string
  checkpointPath: string
}
