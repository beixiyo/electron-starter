/** 真实日志文件验证时间过滤及双预算，新行不能被旧行挤出附件 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { collectDiagnosticLogs } from './collector'

it('过滤坏行和范围外记录，行数或字节不足时保留较新记录', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'diagnostic-logs-'))
  try {
    const directory = join(rootDir, 'session-test')
    await mkdir(directory)
    const lines = [
      JSON.stringify({ time: '2026-01-01T00:00:00Z', message: 'outside' }),
      'broken json',
      ...['old', 'middle', 'new'].map(message => JSON.stringify({ time: '2026-01-02T00:00:00Z', message })),
    ]
    await writeFile(join(directory, 'main.jsonl'), lines.join('\n'))
    const range = { startAt: '2026-01-02T00:00:00Z', endAt: '2026-01-03T00:00:00Z' }
    const byLines = await collectDiagnosticLogs({ rootDir, range, maxLines: 2 })
    const decode = (buffer: ArrayBuffer) => new TextDecoder().decode(buffer).trim().split('\n').map(line => JSON.parse(line).message)
    expect(decode(byLines.attachments[0].buffer)).toEqual(['middle', 'new'])
    expect(byLines.truncated).toBe(true)
    const maxBytes = Buffer.byteLength(lines.at(-1)! + '\n')
    const byBytes = await collectDiagnosticLogs({ rootDir, range, maxBytes })
    expect(decode(byBytes.attachments[0].buffer)).toEqual(['new'])
    expect(byBytes.attachments[0].buffer.byteLength).toBeLessThanOrEqual(maxBytes)
    expect(byBytes.truncated).toBe(true)
    await expect(collectDiagnosticLogs({ rootDir, range: { startAt: range.endAt, endAt: range.startAt } })).rejects.toThrow('time range')
  }
  finally {
    await rm(rootDir, { recursive: true, force: true })
  }
})

it.skipIf(process.platform === 'win32')('单个文件不可读时仍返回其他日志并标明缺失', async () => {
  const { chmod } = await import('node:fs/promises')
  const rootDir = await mkdtemp(join(tmpdir(), 'diagnostic-unreadable-'))
  const directory = join(rootDir, 'session-test')
  const unreadable = join(directory, 'unreadable.jsonl')
  try {
    await mkdir(directory)
    const line = JSON.stringify({ time: '2026-01-02T00:00:00Z', message: 'kept' })
    await writeFile(join(directory, 'readable.jsonl'), line)
    await writeFile(unreadable, line)
    await chmod(unreadable, 0)
    const result = await collectDiagnosticLogs({ rootDir, range: { startAt: '2026-01-01T00:00:00Z', endAt: '2026-01-03T00:00:00Z' } })
    expect(result.lineCount).toBe(1)
    expect(result.skippedFileCount).toBe(1)
    expect(result.truncated).toBe(true)
  }
  finally {
    await chmod(unreadable, 0o600).catch(() => {})
    await rm(rootDir, { recursive: true, force: true })
  }
})
