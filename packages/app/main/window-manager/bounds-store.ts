import type { WindowBounds, WindowType } from '@shared'
import { debounce } from '@jl-org/tool'
import { getUserDataStorageAreaPath, readJsonFileSync, writeJsonFileSync } from '@main/storage'

/**
 * 窗口 bounds 持久化
 *
 * 按 `WindowType` 把尺寸/位置存到 `userData/window-bounds.json`：
 * - 读取带内存缓存，首次读盘后常驻
 * - 写入做 300ms 防抖（resize 期间会高频触发），合并写整个 map
 */

const WRITE_DEBOUNCE = 300

type BoundsMap = Partial<Record<WindowType, WindowBounds>>

let cache: BoundsMap | null = null

function filePath(): string {
  return getUserDataStorageAreaPath('window-bounds')
}

function load(): BoundsMap {
  if (cache)
    return cache

  cache = readJsonFileSync<BoundsMap>(filePath(), {})

  return cache!
}

/** 防抖落盘：resize 期间高频触发，合并写整个 map */
const flushToDisk = debounce(() => {
  if (!cache)
    return

  try {
    writeJsonFileSync(filePath(), cache)
  }
  catch {
    /** 落盘失败不致命，忽略 */
  }
}, WRITE_DEBOUNCE)

export function getSavedBounds(type: WindowType): WindowBounds | undefined {
  return load()[type]
}

export function saveBounds(type: WindowType, bounds: WindowBounds): void {
  load()[type] = bounds
  flushToDisk()
}
