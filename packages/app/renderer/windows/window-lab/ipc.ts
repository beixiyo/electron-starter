/** 可选的 Window Lab Electron 桥；浏览器环境不会触发任何 IPC。 */

import { isElectron } from '@/utils/env'
import type { WindowLabApi } from './types'

export function getWindowLabApi(): WindowLabApi | null {
  if (!isElectron()) return null

  const candidate = (globalThis as unknown as { $ipc?: { windowLab?: unknown } }).$ipc?.windowLab
  if (!candidate || typeof candidate !== 'object') return null

  const api = candidate as Partial<WindowLabApi>
  return typeof api.openPreview === 'function' && typeof api.closePreview === 'function'
    ? api as WindowLabApi
    : null
}
