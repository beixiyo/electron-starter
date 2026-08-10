// 提供 native recorder 的 stderr 日志与轻量格式化工具

import Foundation
import CoreMedia

// 录音 helper 共用的 stderr 日志与文本格式化支持，不承担 stdout 协议、NSError 展开或设备探测

/** 转义手写 JSON 字符串中的反斜杠、引号和换行 */
func escapeJSON(_ s: String) -> String {
  s.replacingOccurrences(of: "\\", with: "\\\\")
   .replacingOccurrences(of: "\"", with: "\\\"")
   .replacingOccurrences(of: "\n", with: "\\n")
}

/** 向 stderr 写入不干扰 stdout NDJSON 协议的诊断日志 */
func log(_ msg: String) {
  FileHandle.standardError.write("[\(msg)]\n".data(using: .utf8)!)
}

/** 将 CMTime 格式化为便于诊断的秒数，非法时间返回 invalid */
func formatCMTimeSeconds(_ time: CMTime) -> String {
  guard time.isValid, time.seconds.isFinite else { return "invalid" }
  return String(format: "%.6f", time.seconds)
}
