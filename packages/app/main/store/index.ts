import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

// TODO: customize DEFAULT_DIR for your app, e.g. join(homedir(), '.my-app')
const DEFAULT_DIR = join(homedir(), '.electron-app')

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
    try {
      if (!existsSync(filePath))
        return { ...defaults }
      return JSON.parse(readFileSync(filePath, 'utf-8')) as T
    }
    catch {
      return { ...defaults }
    }
  }

  const write = (data: T): void => {
    try {
      mkdirSync(dirname(filePath), { recursive: true })
      writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
    }
    catch (error) {
      console.error(`[store] write failed (${filePath}):`, error)
    }
  }

  return { read, write }
}
