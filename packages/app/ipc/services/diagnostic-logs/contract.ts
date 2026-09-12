/** 诊断日志附件契约，只接受时间范围，不接受调用方指定磁盘路径 */
import type { IpcContract } from '@ipc/core'

/** 诊断日志服务 */
export type DiagnosticLogsContract = IpcContract<{
  mainHandle: {
    collect: (payload?: CollectDiagnosticLogsPayload) => CollectDiagnosticLogsResult
  }
}>

/** 日志收集范围 */
export interface CollectDiagnosticLogsPayload {
  /** 范围开始时间，ISO 格式；包含边界 */
  startAt: string
  /** 范围结束时间，ISO 格式；包含边界 */
  endAt: string
}

/** 可供调用方下载或上传的附件；本服务不主动上传 */
export interface DiagnosticLogAttachment {
  fileName: string
  mimeType: string
  buffer: ArrayBuffer
}

/** 有界日志收集结果 */
export interface CollectDiagnosticLogsResult {
  hasLogs: boolean
  lineCount: number
  fileCount: number
  /** 因轮转或读取异常跳过的文件数 */
  skippedFileCount: number
  truncated: boolean
  attachments: DiagnosticLogAttachment[]
}
