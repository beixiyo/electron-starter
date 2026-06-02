import type { WindowBounds, WindowType } from '@shared'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { debounce } from '@jl-org/tool'
import { app } from 'electron'

/**
 * 窗口 bounds 持久化
 *
 * 按 `WindowType` 把尺寸/位置存到 `userData/window-bounds.json`：
 * - 读取带内存缓存，首次读盘后常驻
 * - 写入做 300ms 防抖（resize 期间会高频触发），合并写整个 map
 */

const FILE_NAME = 'window-bounds.json'
const WRITE_DEBOUNCE = 300

type BoundsMap = Partial<Record<WindowType, WindowBounds>>

let cache: BoundsMap | null = null

function filePath(): string {
  return join(app.getPath('userData'), FILE_NAME)
}

function load(): BoundsMap {
  if (cache)
    return cache

  try {
    cache = existsSync(filePath())
      ? JSON.parse(readFileSync(filePath(), 'utf-8'))
      : {}
  }
  catch {
    cache = {}
  }

  return cache!
}

/** 防抖落盘：resize 期间高频触发，合并写整个 map */
const flushToDisk = debounce(() => {
  if (!cache)
    return

  try {
    writeFileSync(filePath(), JSON.stringify(cache, null, 2))
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
