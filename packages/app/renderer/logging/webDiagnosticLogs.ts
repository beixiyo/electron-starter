/** Web 诊断日志落地与有界导出；存储失败不进入日志链，避免递归。 */
import type { CollectDiagnosticLogsPayload, CollectDiagnosticLogsResult } from '@ipc/services/diagnostic-logs/contract'
import type { LogRecordPayload } from '@jl-org/log'
import { diagnosticLogDB } from '@/services/storage/diagnosticLogDB'

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const MAX_COLLECT_LINES = 10_000
const MAX_COLLECT_BYTES = 10 * 1024 * 1024
const sessionId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`

/** 追加单条结构化记录；日志持久化失败不会阻断调用方。 */
export function appendWebDiagnosticLog(record: LogRecordPayload): void {
  const timestamp = Date.parse(record.time ?? '')
  if (!Number.isFinite(timestamp))
    return

  const meta = record.meta ?? {}
  void diagnosticLogDB.add({
    ...meta,
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    timestamp,
    sessionId,
    time: new Date(timestamp).toISOString(),
    level: record.level,
    message: record.message,
    module: typeof meta.module === 'string'
      ? meta.module
      : '',
    event: typeof meta.event === 'string'
      ? meta.event
      : '',
    process: 'renderer',
    window: typeof meta.window === 'string'
      ? meta.window
      : '',
    route: typeof meta.route === 'string'
      ? meta.route
      : '',
    platform: 'web',
    appVersion: __APP_VERSION__,
    ...(record.detail !== undefined
      ? { detail: record.detail }
      : {}),
  }).catch(() => {})
}

/** 初始化保留策略；不使用功能 logger，避免 IndexedDB 故障递归写日志。 */
export function initWebDiagnosticLogStorage(): void {
  void diagnosticLogDB.pruneBefore(Date.now() - RETENTION_MS).catch(() => {})
}

/** 按时间范围导出 JSONL；与桌面日志保持相同附件契约，只保留预算内的最新记录。 */
export async function collectWebDiagnosticLogs(payload: CollectDiagnosticLogsPayload): Promise<CollectDiagnosticLogsResult> {
  const start = Date.parse(payload.startAt)
  const end = Date.parse(payload.endAt)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end)
    throw new Error('Invalid diagnostic log time range')

  const records = await diagnosticLogDB.getByTimestampRange(start, end, { limit: MAX_COLLECT_LINES + 1, direction: 'prev' })
  const lines: string[] = []
  const sessions = new Set<string>()
  const encoder = new TextEncoder()
  let bytes = 0
  for (let index = 0; index < records.length; index++) {
    const { id: _id, timestamp: _timestamp, ...record } = records[index]
    let line: string
    try {
      line = stringifyDiagnosticRecord(record)
    }
    catch {
      /** 极端深度或损坏记录不能让其他诊断记录一起丢失。 */
      continue
    }
    const size = encoder.encode(`${line}\n`).byteLength
    if (lines.length >= MAX_COLLECT_LINES || bytes + size > MAX_COLLECT_BYTES)
      break
    bytes += size
    lines.push(line)
    sessions.add(record.sessionId)
  }
  lines.reverse()
  return {
    hasLogs: lines.length > 0,
    lineCount: lines.length,
    fileCount: sessions.size,
    skippedFileCount: 0,
    truncated: lines.length < records.length,
    attachments: lines.length ? [{
      fileName: 'app-web-diagnostics.jsonl',
      mimeType: 'application/x-ndjson',
      buffer: encoder.encode(`${lines.join('\n')}\n`).buffer,
    }] : [],
  }
}

/** IndexedDB 可以存储 BigInt 和循环对象，JSONL 需要把这些值转成可读的诊断描述。 */
function stringifyDiagnosticRecord(record: Record<string, unknown>): string {
  const seen = new WeakSet<object>()
  return JSON.stringify(record, (_key, value: unknown) => {
    if (typeof value === 'bigint') return value.toString()
    if (value && typeof value === 'object') {
      if (seen.has(value)) return '[Repeated reference]'
      seen.add(value)
    }
    return value
  })
}
