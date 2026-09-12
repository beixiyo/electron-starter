/** 任意异常原因可以进入 IndexedDB；单条不可直接 JSON.stringify 的 detail 不能破坏整个附件。 */
import { expect, it, vi } from 'vitest'

const readRecords = vi.hoisted(() => vi.fn())
vi.mock('@/services/storage/diagnosticLogDB', () => ({
  diagnosticLogDB: { getByTimestampRange: readRecords },
}))

import { collectWebDiagnosticLogs } from './webDiagnosticLogs'

it('exports neighboring records together with bigint and circular exception details', async () => {
  const circular: { reason: string, self?: unknown } = { reason: 'request rejected' }
  circular.self = circular
  const timestamp = Date.parse('2026-09-12T00:00:00Z')
  readRecords.mockResolvedValue([
    { id: 'latest', timestamp, sessionId: 'session', message: 'after failure', detail: null },
    { id: 'cycle', timestamp, sessionId: 'session', message: 'circular failure', detail: circular },
    { id: 'bigint', timestamp, sessionId: 'session', message: 'numeric failure', detail: 123n },
  ])

  const result = await collectWebDiagnosticLogs({
    startAt: '2026-09-11T00:00:00Z', endAt: '2026-09-13T00:00:00Z',
  })
  expect(result.truncated).toBe(false)
  expect(result.lineCount).toBe(3)
  const records = new TextDecoder().decode(result.attachments[0].buffer).trim().split('\n').map(line => JSON.parse(line))
  expect(records).toEqual([
    { sessionId: 'session', message: 'numeric failure', detail: '123' },
    { sessionId: 'session', message: 'circular failure', detail: { reason: 'request rejected', self: '[Repeated reference]' } },
    { sessionId: 'session', message: 'after failure', detail: null },
  ])
})
