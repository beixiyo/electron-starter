/** 以流式读取和双预算收集本地 session 日志，不涉及业务恢复数据 */
import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { CollectDiagnosticLogsPayload, CollectDiagnosticLogsResult } from './contract'

/** 从可信日志根目录收集附件，文件被轮转删除时跳过该文件 */
export async function collectDiagnosticLogs(options: CollectLogsOptions): Promise<CollectDiagnosticLogsResult> {
  const { rootDir, range } = options
  const maxLines = options.maxLines ?? 200_000
  const maxBytes = options.maxBytes ?? 50 * 1024 * 1024
  const start = Date.parse(range.startAt)
  const end = Date.parse(range.endAt)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end)
    throw new Error('Invalid diagnostic log time range')
  if (!Number.isSafeInteger(maxLines) || maxLines < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw new Error('Invalid diagnostic log budget')

  const files: Array<{ path: string, modified: number }> = []
  for (const session of await readdir(rootDir, { withFileTypes: true }).catch(() => [])) {
    if (!session.isDirectory() || !session.name.startsWith('session'))
      continue
    const directory = join(rootDir, session.name)
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl'))
        continue
      const path = join(directory, entry.name)
      const info = await stat(path).catch(() => null)
      if (info?.isFile())
        files.push({ path, modified: info.mtimeMs })
    }
  }
  files.sort((a, b) => b.modified - a.modified || b.path.localeCompare(a.path))

  const segments: string[][] = []
  let lineCount = 0
  let byteCount = 0
  let truncated = false
  let skippedFileCount = 0
  for (const file of files) {
    if (lineCount >= maxLines || byteCount >= maxBytes) {
      truncated = true
      break
    }
    const remainingLines = maxLines - lineCount
    const remainingBytes = maxBytes - byteCount
    const lines: Array<{ value: string, bytes: number }> = []
    let head = 0
    let bytes = 0
    const input = createReadStream(file.path, { encoding: 'utf8' })
    const reader = createInterface({ input, crlfDelay: Infinity })
    try {
      for await (const line of reader) {
        let record: { time?: unknown, timestamp?: unknown }
        try { record = JSON.parse(line) }
        catch { continue }
        if (!record || typeof record !== 'object')
          continue
        const rawTime = typeof record.time === 'string'
          ? record.time
          : record.timestamp
        const time = typeof rawTime === 'string'
          ? Date.parse(rawTime)
          : NaN
        if (!Number.isFinite(time) || time < start || time > end)
          continue
        const size = Buffer.byteLength(line + '\n')
        if (size > remainingBytes) {
          truncated = true
          continue
        }
        lines.push({ value: line, bytes: size })
        bytes += size
        while (lines.length - head > remainingLines || bytes > remainingBytes) {
          bytes -= lines[head++].bytes
          truncated = true
        }
        /** 定期释放已淘汰的旧行，避免输入很长时数组本身无限增长 */
        if (head > 1024) {
          lines.splice(0, head)
          head = 0
        }
      }
    }
    catch {
      /** 日志轮转、权限变化或损坏不能阻断其他文件；结果明确标记不完整 */
      skippedFileCount++
      truncated = true
    }
    finally {
      reader.close()
      input.destroy()
    }
    const kept = lines.slice(head).map(line => line.value)
    if (kept.length) {
      segments.push(kept)
      lineCount += kept.length
      byteCount += bytes
    }
  }
  const content = segments.reverse().flat().join('\n')
  const attachments = content ? [{
    fileName: 'diagnostic-logs.jsonl',
    mimeType: 'application/x-ndjson',
    buffer: new TextEncoder().encode(content + '\n').buffer,
  }] : []
  return { hasLogs: lineCount > 0, lineCount, fileCount: files.length, skippedFileCount, truncated, attachments }
}

/** 收集器可信依赖与预算；IPC 层不允许渲染进程覆写路径或预算 */
export interface CollectLogsOptions {
  rootDir: string
  range: CollectDiagnosticLogsPayload
  /**
   * 最大行数
   * @default 200000
   */
  maxLines?: number
  /**
   * 最大 UTF-8 字节数
   * @default 52428800
   */
  maxBytes?: number
}
