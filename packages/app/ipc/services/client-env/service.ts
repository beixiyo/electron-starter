import { execFile } from 'node:child_process'
import { statfs } from 'node:fs/promises'
import { freemem, totalmem } from 'node:os'
import { promisify } from 'node:util'
import { createIpcService } from '@ipc/core'
import { app } from 'electron'
import type { ClientEnvContract, ClientEnvPlatform, ClientEnvSnapshot } from './contract'

const execFileAsync = promisify(execFile)

export const clientEnvService = createIpcService<ClientEnvContract>('client-env', {
  mainHandle: {
    async getPlatform() {
      return toClientEnvPlatform(process.platform)
    },
    async getSnapshot() {
      return getClientEnvSnapshot()
    },
  },
})

/** 获取主进程权威客户端环境，供 IPC 和主进程内部服务复用。 */
export async function getClientEnvSnapshot(): Promise<ClientEnvSnapshot> {
  const rawPlatform = process.platform

  return {
    platform: toClientEnvPlatform(rawPlatform),
    rawPlatform,
    arch: process.arch,
    osVersion: getSystemVersion(rawPlatform),
    deviceModel: await getDeviceModel(rawPlatform),
    appVersion: app.getVersion(),
    totalMemoryBytes: totalmem(),
    availableMemoryBytes: freemem(),
    ...await getDiskSpace(),
  }
}

function getSystemVersion(platform: NodeJS.Platform): string {
  const version = process.getSystemVersion()
  const name = getSystemName(platform)

  return version
    ? `${name} ${version}`
    : name
}

/** 机型在进程生命周期内不会变；缓存 Promise 也能合并并发的 sysctl 调用。 */
let deviceModelPromise: Promise<string> | null = null

function getDeviceModel(platform: NodeJS.Platform): Promise<string> {
  deviceModelPromise ??= resolveDeviceModel(platform)
  return deviceModelPromise
}

async function resolveDeviceModel(platform: NodeJS.Platform): Promise<string> {
  if (platform === 'darwin') {
    const model = await readCommand('sysctl', ['-n', 'hw.model'])
    return model || `Mac (${process.arch})`
  }

  return `${getSystemName(platform)} (${process.arch})`
}

async function readCommand(command: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(command, args, {
      timeout: 1000,
      windowsHide: true,
    })

    return stdout.trim()
  }
  catch {
    return ''
  }
}

async function getDiskSpace(): Promise<DiskSpaceSnapshot> {
  try {
    const stats = await statfs(app.getPath('userData'))
    const blockSize = Number(stats.bsize)

    return {
      totalDiskSpaceBytes: Number(stats.blocks) * blockSize,
      availableDiskSpaceBytes: Number(stats.bavail) * blockSize,
    }
  }
  catch {
    return {}
  }
}

function getSystemName(platform: NodeJS.Platform): string {
  switch (platform) {
    case 'darwin':
      return 'macOS'
    case 'win32':
      return 'Windows'
    case 'linux':
      return 'Linux'
    default:
      return platform
  }
}

function toClientEnvPlatform(platform: NodeJS.Platform): ClientEnvPlatform {
  switch (platform) {
    case 'darwin':
      return 'mac'
    case 'win32':
      return 'windows'
    case 'linux':
      return 'linux'
    default:
      return 'unknown'
  }
}

type DiskSpaceSnapshot = Partial<Pick<
  ClientEnvSnapshot,
  | 'totalDiskSpaceBytes'
  | 'availableDiskSpaceBytes'
>>
