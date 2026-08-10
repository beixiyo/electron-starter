// 将 AVFoundation 与 POSIX 错误归一为录音日志和状态协议需要的诊断信息

import Darwin
import Foundation

/** 展开 NSError 为 domain#code，并附带一层 underlying 错误码 */
func describeError(_ error: Error?) -> String {
  guard let error else { return "unknown" }
  let ns = error as NSError
  var desc = "\(ns.domain)#\(ns.code): \(ns.localizedDescription)"
  if let underlying = ns.userInfo[NSUnderlyingErrorKey] as? NSError {
    desc += " underlying=\(underlying.domain)#\(underlying.code)"
  }
  return desc
}

/** 沿 NSError 错误链识别磁盘写满对应的 POSIX ENOSPC */
func isStorageInsufficientError(_ error: Error?) -> Bool {
  guard let error else { return false }
  return isStorageInsufficientNSError(error as NSError)
}

private func isStorageInsufficientNSError(_ error: NSError) -> Bool {
  if error.domain == NSPOSIXErrorDomain && error.code == Int(ENOSPC) {
    return true
  }

  guard let underlying = error.userInfo[NSUnderlyingErrorKey] as? NSError else {
    return false
  }
  return isStorageInsufficientNSError(underlying)
}
