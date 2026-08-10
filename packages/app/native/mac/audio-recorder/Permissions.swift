// 检查和请求屏幕录制与系统音频采集权限

import CoreFoundation
import CoreGraphics
import Darwin
import Foundation

// MARK: - CLI 权限探测入口（--check/--prompt-*，探测完即 exit）

func isScreenCaptureTrusted() -> Bool {
  if #available(macOS 10.15, *) {
    return CGPreflightScreenCaptureAccess()
  }
  return true
}

func requestScreenCaptureAccess() -> Bool {
  if #available(macOS 10.15, *) {
    return CGRequestScreenCaptureAccess()
  }
  return true
}

// ── System Audio Recording Only 权限(kTCCServiceAudioCapture)──
// process tap 录音的独立 TCC 权限,与屏幕录制完全分开;无公开查询 API,
// 经私有 TCC.framework 探测(Developer ID 分发可用,MAS 禁用私有 SPI)。
// 弹窗归属 responsible process(父 Electron app),usage description 已在 electron-builder.yml 注入

typealias TCCAccessPreflightFn = @convention(c) (CFString, CFDictionary?) -> Int32
typealias TCCAccessRequestFn = @convention(c) (CFString, CFDictionary?, @escaping (Bool) -> Void) -> Void

func loadTCCFunctions() -> (preflight: TCCAccessPreflightFn, request: TCCAccessRequestFn)? {
  guard let handle = dlopen("/System/Library/PrivateFrameworks/TCC.framework/Versions/A/TCC", RTLD_NOW),
        let preflightSymbol = dlsym(handle, "TCCAccessPreflight"),
        let requestSymbol = dlsym(handle, "TCCAccessRequest")
  else { return nil }

  return (
    unsafeBitCast(preflightSymbol, to: TCCAccessPreflightFn.self),
    unsafeBitCast(requestSymbol, to: TCCAccessRequestFn.self)
  )
}

let kTCCServiceAudioCaptureName = "kTCCServiceAudioCapture" as CFString
