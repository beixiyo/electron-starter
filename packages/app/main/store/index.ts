import { join } from 'node:path'
import { getAppStorageAreaPath, readJsonFileSync, writeJsonFileSync } from '@main/storage'

const DEFAULT_DIR = getAppStorageAreaPath('main-json-store')

export type StoreOptions = {
  /** @default "~/.electron-app" */
  dir?: string
}

export type Store<T extends object> = {
  read: () => T
  write: (data: T) => void
}

/**
 * 创建一个 JSON 文件 store，默认存储到 ~/.electron-app/<filename>
 *
 * @param filename  文件名，如 `shortcut-bindings.json`
 * @param defaults  读取失败或文件不存在时的默认值
 */
export function createStore<T extends object>(
  filename: string,
  defaults: T,
  options: StoreOptions = {},
): Store<T> {
  const dir = options.dir ?? DEFAULT_DIR
  const filePath = join(dir, filename)

  const read = (): T => {
    return readJsonFileSync(filePath, defaults)
  }

  const write = (data: T): void => {
    try {
      writeJsonFileSync(filePath, data)
    }
    catch (error) {
      console.error(`[store] write failed (${filePath}):`, error)
    }
  }

  return { read, write }
}
