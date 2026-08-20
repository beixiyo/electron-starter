import { createIpcService } from '@ipc/core'
import { getNativeBinaryPath } from '@main/native-bridge'
import { app } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'
import type { HourCycle, SystemPreferencesContract } from './contract'

const execFileAsync = promisify(execFile)
const HOUR_CYCLE_TIMEOUT_MS = 1_000
const HOUR_CYCLE_WATCHER_ARGS = ['--watch'] as const

let hourCycleWatcherStarted = false
let hourCycleWatcher: ReturnType<typeof spawn> | null = null
let currentHourCycle: HourCycle | null = null
let hasReceivedInitialHourCycle = false

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

/**
 * 监听 macOS 系统偏好变化
 *
 * macOS 的 UserDefaults 通知无法可靠覆盖系统设置进程的外部修改，因此由 native helper
 * 通过 KVO 监听全局 UserDefaults，并仅在有效值变化时广播给所有 renderer。主进程启动后调用一次即可
 */
export function startSystemPreferencesListener(): void {
  if (process.platform !== 'darwin' || hourCycleWatcherStarted) return

  const binaryPath = getNativeBinaryPath('hour-cycle')
  if (!existsSync(binaryPath)) return

  hourCycleWatcherStarted = true
  try {
    const child = spawn(binaryPath, HOUR_CYCLE_WATCHER_ARGS, {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    hourCycleWatcher = child

    child.stdout?.setEncoding('utf8')
    let buffer = ''
    child.stdout?.on('data', (data: string) => {
      buffer += data
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const value = line.trim()
        if (value === '12' || value === '24') {
          updateHourCycle(Number(value) as HourCycle)
        }
      }
    })

    child.on('error', () => {
      if (hourCycleWatcher === child) hourCycleWatcher = null
    })
    child.on('exit', () => {
      if (hourCycleWatcher === child) hourCycleWatcher = null
    })

    app.once('will-quit', stopSystemPreferencesListener)
  }
  catch {
    hourCycleWatcherStarted = false
  }
}

function stopSystemPreferencesListener(): void {
  hourCycleWatcher?.kill()
  hourCycleWatcher = null
  hourCycleWatcherStarted = false
  currentHourCycle = null
  hasReceivedInitialHourCycle = false
}

function updateHourCycle(nextHourCycle: HourCycle): void {
  const changed = currentHourCycle !== nextHourCycle
  currentHourCycle = nextHourCycle

  if (hasReceivedInitialHourCycle && changed) {
    systemPreferencesService.emit('hourCycleChanged', nextHourCycle)
  }

  hasReceivedInitialHourCycle = true
}
