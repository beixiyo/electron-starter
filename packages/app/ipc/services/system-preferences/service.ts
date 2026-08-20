import { createIpcService } from '@ipc/core'
import { getNativeBinaryPath } from '@main/native-bridge'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'
import type { HourCycle, SystemPreferencesContract } from './contract'

const execFileAsync = promisify(execFile)
const HOUR_CYCLE_TIMEOUT_MS = 1_000

export const systemPreferencesService = createIpcService<SystemPreferencesContract>('system-preferences', {
  mainHandle: {
    async getHourCycle() {
      return readMacHourCycle()
    },
  },
})

/**
 * 读取 macOS Foundation 计算出的当前小时制
 *
 * 只在主进程访问 native helper；开发环境未构建 helper、非 macOS 或 helper 失败时返回 null，
 * 由 renderer 保留 Web / Intl fallback
 */
export async function readMacHourCycle(): Promise<HourCycle | null> {
  if (process.platform !== 'darwin') return null

  const binaryPath = getNativeBinaryPath('hour-cycle')
  if (!existsSync(binaryPath)) return null

  try {
    const { stdout } = await execFileAsync(binaryPath, [], {
      timeout: HOUR_CYCLE_TIMEOUT_MS,
    })
    const value = stdout.trim()
    if (value === '12' || value === '24') return Number(value) as HourCycle
  }
  catch {
    return null
  }

  return null
}
