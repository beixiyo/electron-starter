import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
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

/**
 * 异步读取 JSON 文件，读取失败时返回 undefined。
 */
export async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(filePath, 'utf-8')) as T
  }
  catch {
    return undefined
  }
}

/**
 * 原子写入 JSON 文件：先写同目录唯一临时文件，再 rename 到目标路径。
 */
export async function writeJsonFileAtomic<T>(filePath: string, data: T): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })

  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, JSON.stringify(data), 'utf-8')
    await rename(temporaryPath, filePath)
  }
  finally {
    await rm(temporaryPath, { force: true }).catch(() => {})
  }
}
