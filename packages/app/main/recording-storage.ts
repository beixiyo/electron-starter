import { statfs } from 'node:fs/promises'
import { homedir } from 'node:os'
import { createMainDiagnosticLogger } from '@main/logging'
import { shell } from 'electron'

/** 预留 1 GiB，覆盖长录音、临时文件和停止阶段合成 */
export const MIN_RECORDING_AVAILABLE_SPACE_BYTES = 1024 ** 3

const log = createMainDiagnosticLogger('native.recording')
const listeners = new Set<(availableBytes: number, context: RecordingStorageCheckContext) => void>()

/** 检查应用录音目录所在磁盘是否保留了足够的安全空间 */
export async function ensureRecordingStorageAvailable(
  context: RecordingStorageCheckContext = 'start',
): Promise<boolean> {
  try {
    const stats = await statfs(homedir())
    const availableBytes = Number(stats.bavail) * Number(stats.bsize)
    const available = availableBytes >= MIN_RECORDING_AVAILABLE_SPACE_BYTES

    if (!available) {
      log.warn('recorder.startBlocked.storage', 'recording blocked by insufficient storage', {
        availableBytes,
        thresholdBytes: MIN_RECORDING_AVAILABLE_SPACE_BYTES,
        context,
      })
      listeners.forEach(listener => listener(availableBytes, context))
    }

    return available
  }
  catch (error) {
    log.error('recorder.storageCheck.failed', 'failed to inspect recording storage', error)
    return true
  }
}

export function onRecordingStorageInsufficient(
  listener: (availableBytes: number, context: RecordingStorageCheckContext) => void,
): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Native writer 已明确返回 ENOSPC 时，强制走同一个产品承接面 */
export function reportRecordingStorageInsufficient(context: RecordingStorageCheckContext = 'write'): void {
  listeners.forEach(listener => listener(0, context))
}

/** 打开系统存储管理入口；Linux 无统一设置协议，回退到用户目录 */
export async function openStorageSettings(): Promise<void> {
  if (process.platform === 'darwin') {
    await shell.openExternal('x-apple.systempreferences:com.apple.settings.Storage')
    return
  }

  if (process.platform === 'win32') {
    await shell.openExternal('ms-settings:storagesense')
    return
  }

  await shell.openPath(homedir())
}

export type RecordingStorageCheckContext = 'start' | 'recording' | 'resume' | 'write'
