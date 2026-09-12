/** 诊断日志 IPC 客户端 */
import { createServiceClient } from '@ipc/core'
import type { DiagnosticLogsContract } from './contract'

export const diagnosticLogsClient = createServiceClient<DiagnosticLogsContract>('diagnostic-logs', ['collect'])
