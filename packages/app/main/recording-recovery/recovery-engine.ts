/** Checkpoint、麦克风 sidecar 事务与 native helper 的恢复编排 */

import { execFile } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import { getNativeBinaryPath } from '@main/native-bridge'
import {
  getRecoveryCheckpointDir,
  getRecoveryMicBackupPath,
  getRecoveryMicPendingPath,
  getRecoveryMicSidecarPath,
  getRecoveryOutputPath,
} from './paths'

const recoveryInFlight = new Map<string, Promise<boolean>>()

/** 同一主进程内同 taskId 只允许一个恢复流程触发 native helper */
export function recoverRecordingTask(taskId: string): Promise<boolean> {
  const existing = recoveryInFlight.get(taskId)
  if (existing)
    return existing

  const promise = recoverRecordingTaskInternal(taskId)
  recoveryInFlight.set(taskId, promise)
  void promise.finally(() => {
    if (recoveryInFlight.get(taskId) === promise)
      recoveryInFlight.delete(taskId)
  }).catch(() => { /* 恢复流程内部失败时返回 false */ })
  return promise
}

/** 删除资产前等待同 taskId 已开始的恢复流程退出 */
export async function waitForRecoveryTask(taskId: string): Promise<void> {
  const inFlight = recoveryInFlight.get(taskId)
  if (!inFlight)
    return

  try {
    await inFlight
  }
  catch {
    /** 恢复失败时仍继续清理业务资产，native lock 留给后续恢复 */
  }
}

async function recoverRecordingTaskInternal(taskId: string): Promise<boolean> {
  const hasMicTransaction = await hasMicSidecarTransaction(taskId)
  const hasMicSidecar = await recoveryAssetExists(getRecoveryMicSidecarPath(taskId))
  if (hasMicTransaction) {
    /** 已开始 sidecar 事务时必须先按 inode 判断是否已提交，checkpoint 不能覆盖它 */
    if (!await recoverMicSidecarIfNeeded(taskId)) {
      /** helper 只会在确认事务尚未提交时撤销 marker/backup；仍存在则必须按安全失败处理 */
      if (await hasMicSidecarTransaction(taskId))
        return false

      /** 坏主文件导致的 pending 已回滚：先用 checkpoint 重建主轨，再重新混入 sidecar */
      if (!await recoverCheckpointIfNeeded(taskId))
        return false
      if (
        await recoveryAssetExists(getRecoveryMicSidecarPath(taskId))
        && !await recoverMicSidecarIfNeeded(taskId)
      ) {
        return false
      }
    }
  }
  else {
    if (!await recoverCheckpointIfNeeded(taskId))
      return false
    if (hasMicSidecar && !await recoverMicSidecarIfNeeded(taskId))
      return false
  }

  return runRecoveryCommand(['--validate-audio', getRecoveryOutputPath(taskId)], 30_000)
}

async function recoverCheckpointIfNeeded(taskId: string): Promise<boolean> {
  const segmentDir = getRecoveryCheckpointDir(taskId)
  let checkpoint
  try {
    checkpoint = await stat(segmentDir)
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return true
    console.warn('[recording-recovery] cannot inspect checkpoint assets', error)
    return false
  }
  if (!checkpoint.isDirectory())
    return false

  let checkpointEntries
  try {
    checkpointEntries = await readdir(segmentDir, { withFileTypes: true })
  }
  catch (error) {
    console.warn('[recording-recovery] cannot inspect checkpoint segments', error)
    return false
  }

  const hasCheckpointSegment = checkpointEntries.some(entry => (
    entry.isFile()
    && entry.name.endsWith('.m4a')
    && !entry.name.startsWith('_mix_')
  ))
  if (!hasCheckpointSegment)
    return true

  return runRecoveryCommand(['--merge-checkpoints', segmentDir, getRecoveryOutputPath(taskId)])
}

async function recoverMicSidecarIfNeeded(taskId: string): Promise<boolean> {
  const sidecarPath = getRecoveryMicSidecarPath(taskId)
  const hasTransaction = await hasMicSidecarTransaction(taskId)

  /** marker / backup 会保留到 renderer 导入成功；helper 只判定并完成事务 */
  if (hasTransaction)
    return runRecoveryCommand(['--recover-mic-sidecar', sidecarPath, getRecoveryOutputPath(taskId)])

  let sidecar
  try {
    sidecar = await stat(sidecarPath)
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return true
    console.warn('[recording-recovery] cannot inspect microphone sidecar', error)
    return false
  }

  if (!sidecar.isFile())
    return false

  return runRecoveryCommand(['--recover-mic-sidecar', sidecarPath, getRecoveryOutputPath(taskId)])
}

async function hasMicSidecarTransaction(taskId: string): Promise<boolean> {
  return await recoveryAssetExists(getRecoveryMicBackupPath(taskId))
    || await recoveryAssetExists(getRecoveryMicPendingPath(taskId))
}

async function recoveryAssetExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return false
    console.warn('[recording-recovery] cannot inspect recovery asset', path, error)
    /** 权限/IO 异常按存在处理，避免绕过事务而暴露不确定 output */
    return true
  }
}

function runRecoveryCommand(args: string[], timeout = 5 * 60 * 1000): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    execFile(getNativeBinaryPath('audio-recorder'), args, { timeout }, (error) => {
      if (error) {
        console.warn(`[recording-recovery] helper failed: ${args[0]}`, error.message)
        resolve(false)
        return
      }

      resolve(true)
    })
  })
}
