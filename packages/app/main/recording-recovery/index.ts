import type { NativeRecordingSource } from '@shared'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import {
  assertTaskId,
  collectTaskIds,
  getRecoveryCheckpointDir,
  getRecoveryManifestPath,
  getRecoveryMicBackupPath,
  getRecoveryMicPendingPath,
  getRecoveryMicSidecarPath,
  getRecoveryOutputPath,
  getRealtimeDeliveryTempPath,
  RECORDING_RECOVERY_DIR,
} from './paths'
import { recoverRecordingTask, waitForRecoveryTask } from './recovery-engine'

export { RECORDING_RECOVERY_DIR } from './paths'

/**
 * 创建一条可跨崩溃恢复的 native 录音会话
 */
export function createRecordingRecoverySession(
  source: NativeRecordingSource,
  name?: string,
  audioSources?: RecordingRecoveryAudioSources,
): RecordingRecoverySession {
  mkdirSync(RECORDING_RECOVERY_DIR, { recursive: true })

  const taskId = randomUUID()
  const outputPath = getRecoveryOutputPath(taskId)
  const manifest: RecordingRecoveryManifest = {
    taskId,
    source,
    name,
    ...audioSources,
    mimeType: 'audio/mp4',
    createdAt: Date.now(),
  }

  writeFileSync(getRecoveryManifestPath(taskId), JSON.stringify(manifest, null, 2), 'utf-8')
  return { ...manifest, outputPath }
}

/**
 * 扫描并修复崩溃残留录音，活跃 writer 对应的文件不会暴露给 renderer
 */
export async function listRecoverableRecordings(activeOutputPath?: string): Promise<RecoverableRecording[]> {
  await mkdirRecoveryDir()

  const entries = await readdir(RECORDING_RECOVERY_DIR, { withFileTypes: true })
  const activeRealtimeTempName = activeOutputPath
    ? `_realtime_${basename(activeOutputPath)}`
    : null
  await Promise.all(entries
    .filter(entry => entry.isFile() && entry.name.startsWith('_realtime_') && entry.name.endsWith('.m4a'))
    .filter(entry => entry.name !== activeRealtimeTempName)
    .map(entry => rm(join(RECORDING_RECOVERY_DIR, entry.name), { force: true })))
  const taskIds = collectTaskIds(entries.map(entry => entry.name))
  const recordings: RecoverableRecording[] = []

  for (const taskId of taskIds) {
    const outputPath = getRecoveryOutputPath(taskId)
    if (activeOutputPath === outputPath)
      continue

    if (!await recoverRecordingTask(taskId))
      continue

    const file = await stat(outputPath).catch(() => null)
    if (!file?.isFile() || file.size <= 0)
      continue

    const manifest = await readRecoveryManifest(taskId)
    recordings.push({
      taskId,
      path: outputPath,
      name: manifest?.name || `recovered_${taskId.slice(0, 8)}`,
      source: manifest?.source ?? 'manual',
      mimeType: manifest?.mimeType ?? 'audio/mp4',
      createdAt: manifest?.createdAt ?? file.birthtimeMs,
      fileSize: file.size,
      micAudio: manifest?.micAudio ?? true,
      systemAudio: manifest?.systemAudio ?? manifest?.source === 'meeting',
    })
  }

  return recordings.sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * 删除一条恢复任务的全部本地资产
 */
export async function deleteRecoveryRecording(taskId: string): Promise<void> {
  const safeTaskId = assertTaskId(taskId)
  await waitForRecoveryTask(safeTaskId)

  await Promise.all([
    rm(getRecoveryOutputPath(safeTaskId), { force: true }),
    rm(getRecoveryManifestPath(safeTaskId), { force: true }),
    rm(getRecoveryMicSidecarPath(safeTaskId), { force: true }),
    rm(getRecoveryMicBackupPath(safeTaskId), { force: true }),
    rm(getRecoveryMicPendingPath(safeTaskId), { force: true }),
    rm(getRecoveryCheckpointDir(safeTaskId), { recursive: true, force: true }),
    rm(getRealtimeDeliveryTempPath(safeTaskId), { force: true }),
  ])
}

/**
 * 按任务 id 读取恢复目录中的录音，避免 renderer 传入任意文件路径
 */
export async function readRecoveryRecording(taskId: string): Promise<ArrayBuffer> {
  const buffer = await readFile(getRecoveryOutputPath(assertTaskId(taskId)))
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
}

async function mkdirRecoveryDir(): Promise<void> {
  await mkdir(RECORDING_RECOVERY_DIR, { recursive: true })
}

async function readRecoveryManifest(taskId: string): Promise<RecordingRecoveryManifest | null> {
  try {
    const raw = JSON.parse(await readFile(getRecoveryManifestPath(taskId), 'utf-8')) as Partial<RecordingRecoveryManifest>
    if (raw.taskId !== taskId || (raw.source !== 'manual' && raw.source !== 'meeting'))
      return null

    return {
      taskId,
      source: raw.source,
      name: typeof raw.name === 'string'
        ? raw.name
        : undefined,
      mimeType: typeof raw.mimeType === 'string'
        ? raw.mimeType
        : 'audio/mp4',
      createdAt: typeof raw.createdAt === 'number'
        ? raw.createdAt
        : Date.now(),
      micAudio: typeof raw.micAudio === 'boolean'
        ? raw.micAudio
        : undefined,
      systemAudio: typeof raw.systemAudio === 'boolean'
        ? raw.systemAudio
        : undefined,
    }
  }
  catch {
    return null
  }
}

/** 可供 renderer 导入本地存储的崩溃恢复录音 */
export type RecoverableRecording = {
  taskId: string
  path: string
  name: string
  source: NativeRecordingSource
  mimeType: string
  createdAt: number
  fileSize: number
  micAudio: boolean
  systemAudio: boolean
}

/** native 录音会话及其持久化产物路径 */
export type RecordingRecoverySession = RecordingRecoveryManifest & {
  outputPath: string
}

/** 本次录音实际启用的音源 */
export type RecordingRecoveryAudioSources = {
  micAudio: boolean
  systemAudio: boolean
}

type RecordingRecoveryManifest = {
  taskId: string
  source: NativeRecordingSource
  name?: string
  mimeType: string
  createdAt: number
  micAudio?: boolean
  systemAudio?: boolean
}
