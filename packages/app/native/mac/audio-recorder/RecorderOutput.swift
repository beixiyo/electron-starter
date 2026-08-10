// 输出 SCK 与 process tap 引擎共用的 stdout NDJSON 协议

import Darwin
import Foundation

/** 输出录音生命周期状态及其所属产物 */
func emitStatus(_ status: String, path: String, duration: Double? = nil, handoffId: Int? = nil) {
  var json = "{\"status\":\"\(status)\",\"path\":\"\(escapeJSON(path))\""
  if let d = duration {
    json += ",\"duration\":\(String(format: "%.1f", d))"
  }
  if let handoffId {
    json += ",\"handoffId\":\(handoffId)"
  }
  json += "}"
  print(json)
  fflush(stdout)
}

/**
 * 输出非致命诊断事件
 *
 * 刻意不用 emitError——TS 侧对未白名单的 error code 会重置录音状态机并经 discard 链路删除已录音频
 * 未知 status 可安全忽略，需要产品层持久化或提示的降级信号由 TS 显式消费
 */
func emitDiagnostic(_ status: String, detail: String) {
  let json = "{\"status\":\"\(escapeJSON(status))\",\"detail\":\"\(escapeJSON(detail))\"}"
  print(json)
  fflush(stdout)
}

/** 输出尚未绑定到具体录音产物的错误 */
func emitError(_ error: String, detail: String? = nil) {
  var json = "{\"error\":\"\(escapeJSON(error))\""
  if let detail {
    json += ",\"detail\":\"\(escapeJSON(detail))\""
  }
  json += "}"
  print(json)
  fflush(stdout)
}

/** 输出录音中错误并携带所属产物，消费层可拒绝已被下一场录音取代的迟到事件 */
func emitRecordingError(_ error: String, path: String, detail: String? = nil) {
  var json = "{\"error\":\"\(escapeJSON(error))\",\"path\":\"\(escapeJSON(path))\""
  if let detail {
    json += ",\"detail\":\"\(escapeJSON(detail))\""
  }
  json += "}"
  print(json)
  fflush(stdout)
}

/** 输出录音收尾失败 terminal，业务层据产物路径和 handoff 拒绝旧错误污染新 session */
func emitTerminalError(_ error: String, path: String, detail: String? = nil, handoffId: Int? = nil) {
  var json = "{\"error\":\"\(escapeJSON(error))\",\"terminal\":true,\"path\":\"\(escapeJSON(path))\""
  if let handoffId {
    json += ",\"handoffId\":\(handoffId)"
  }
  if let detail {
    json += ",\"detail\":\"\(escapeJSON(detail))\""
  }
  json += "}"
  print(json)
  fflush(stdout)
}

/** 通知主进程在指定 handoff 后回收 helper */
func emitRecycleDirective(handoffId: Int, detail: String) {
  let json = "{\"status\":\"recycle_required\",\"handoffId\":\(handoffId),\"detail\":\"\(escapeJSON(detail))\"}"
  print(json)
  fflush(stdout)
}
