import { mkdir } from 'node:fs/promises'

/**
 * 创建目录，目录已存在时直接复用。
 */
export async function ensureStorageDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
}
