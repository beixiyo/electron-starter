import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * 同步读取 JSON 文件，读取失败时返回 defaults 的浅拷贝
 */
export function readJsonFileSync<T extends object>(filePath: string, defaults: T): T {
  try {
    if (!existsSync(filePath))
      return { ...defaults }

    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as Partial<T>
    return { ...defaults, ...parsed }
  }
  catch {
    return { ...defaults }
  }
}

/**
 * 同步写入 JSON 文件，自动创建父目录
 */
export function writeJsonFileSync<T>(filePath: string, data: T): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
}
