import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readJsonFile, writeJsonFileAtomic } from './json-file'

describe('异步 JSON 文件存储', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'electron-starter-storage-'))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
  })

  it('文件不存在或内容损坏时返回 undefined', async () => {
    const missingPath = join(root, 'missing.json')
    const invalidPath = join(root, 'invalid.json')
    await writeFile(invalidPath, '{invalid', 'utf-8')

    await expect(readJsonFile(missingPath)).resolves.toBeUndefined()
    await expect(readJsonFile(invalidPath)).resolves.toBeUndefined()
  })

  it('并发写入使用不同临时文件，最终文件始终保持完整 JSON', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(123)
    const filePath = join(root, 'nested', 'bindings.json')

    await Promise.all(
      Array.from({ length: 16 }, (_, index) => writeJsonFileAtomic(filePath, { index })),
    )

    const value = JSON.parse(await readFile(filePath, 'utf-8')) as { index: number }
    expect(value.index).toBeGreaterThanOrEqual(0)
    expect(value.index).toBeLessThan(16)
  })

  it('目标替换失败时清理临时文件', async () => {
    const targetPath = join(root, 'target')
    await mkdir(targetPath)

    await expect(writeJsonFileAtomic(targetPath, { value: true })).rejects.toBeDefined()
    await expect(readdir(root)).resolves.toEqual(['target'])
  })
})
