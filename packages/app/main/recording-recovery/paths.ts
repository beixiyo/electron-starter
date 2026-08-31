/** 录音恢复资产的任务 id 校验、命名约定与本地路径 */

import { basename, join } from 'node:path'
import { getAppStorageAreaPath } from '@main/storage'

export const RECORDING_RECOVERY_DIR = getAppStorageAreaPath('recording-recovery-files')

const TASK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const RECOVERY_ASSET_SUFFIXES = [
  '.m4a.mic-backup',
  '.m4a.mic-pending',
  '.m4a.segments',
  '.mic.caf',
  '.m4a',
  '.json',
] as const

export function collectTaskIds(names: string[]): string[] {
  const ids = new Set<string>()

  for (const name of names) {
    const taskId = parseTaskId(name)
    if (taskId)
      ids.add(taskId)
  }

  return [...ids]
}

export function assertTaskId(taskId: string): string {
  if (!TASK_ID_PATTERN.test(taskId) || basename(taskId) !== taskId)
    throw new Error(`Invalid recording task id: ${taskId}`)

  return taskId
}

export function getRecoveryOutputPath(taskId: string): string {
  return join(RECORDING_RECOVERY_DIR, `${taskId}.m4a`)
}

/** 录制期持续写入、stop 时原子替换正式产物的临时 M4A。 */
export function getRealtimeDeliveryTempPath(taskId: string): string {
  return join(RECORDING_RECOVERY_DIR, `_realtime_${assertTaskId(taskId)}.m4a`)
}

export function getRecoveryManifestPath(taskId: string): string {
  return join(RECORDING_RECOVERY_DIR, `${taskId}.json`)
}

export function getRecoveryMicSidecarPath(taskId: string): string {
  return join(RECORDING_RECOVERY_DIR, `${taskId}.mic.caf`)
}

export function getRecoveryMicBackupPath(taskId: string): string {
  return join(RECORDING_RECOVERY_DIR, `${taskId}.m4a.mic-backup`)
}

export function getRecoveryMicPendingPath(taskId: string): string {
  return join(RECORDING_RECOVERY_DIR, `${taskId}.m4a.mic-pending`)
}

export function getRecoveryCheckpointDir(taskId: string): string {
  return join(RECORDING_RECOVERY_DIR, `${taskId}.m4a.segments`)
}

function parseTaskId(name: string): string | null {
  const suffix = RECOVERY_ASSET_SUFFIXES.find(item => name.endsWith(item))
  if (!suffix)
    return null

  const taskId = name.slice(0, -suffix.length)
  return TASK_ID_PATTERN.test(taskId) && basename(taskId) === taskId
    ? taskId
    : null
}
