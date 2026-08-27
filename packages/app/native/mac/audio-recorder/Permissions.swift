// 检查麦克风、屏幕录制与系统音频采集权限

import AVFAudio
import AVFoundation
import CoreFoundation
import CoreGraphics
import Darwin
import Foundation

/**
 * 麦克风采集边界看到的权限快照
 *
 * Electron 主进程的 `systemPreferences.getMediaAccessStatus` 在用户于系统设置中
 * 修改权限后可能仍返回旧值；正式采集必须以真正打开输入设备的 helper 进程为准
 */
struct MicrophonePermissionSnapshot {
  let audioApplication: String
  let captureDevice: String
  let inputMuted: Bool
  let errorCode: String?

  var detail: String {
    "audioApplication=\(audioApplication) captureDevice=\(captureDevice) inputMuted=\(inputMuted)"
  }
}

/** 每次实际启动采集前读取，不缓存 TCC 结果 */
func currentMicrophonePermissionSnapshot() -> MicrophonePermissionSnapshot {
  let audioApplication = describeRecordPermission(AVAudioApplication.shared.recordPermission)
  let captureDevice = describeCaptureAuthorization(AVCaptureDevice.authorizationStatus(for: .audio))
  let errorCode: String?

  if audioApplication == "denied"
    || captureDevice == "denied"
    || captureDevice == "restricted" {
    errorCode = "microphone_permission_denied"
  }
  else if audioApplication == "granted" && captureDevice == "authorized" {
    errorCode = nil
  }
  else if audioApplication == "undetermined" && captureDevice == "not_determined" {
    errorCode = "microphone_permission_not_determined"
  }
  else {
    /** 两套公开 API 不一致时宁可阻断，也不能产出一段被 macOS 归零的静音文件 */
    errorCode = "microphone_permission_inconsistent"
  }

  return MicrophonePermissionSnapshot(
    audioApplication: audioApplication,
    captureDevice: captureDevice,
    inputMuted: AVAudioApplication.shared.isInputMuted,
    errorCode: errorCode
  )
}

private func describeRecordPermission(_ permission: AVAudioApplication.recordPermission) -> String {
  switch permission {
  case .granted:
    return "granted"
  case .denied:
    return "denied"
  case .undetermined:
    return "undetermined"
  @unknown default:
    return "unknown_\(permission.rawValue)"
  }
}

private func describeCaptureAuthorization(_ status: AVAuthorizationStatus) -> String {
  switch status {
  case .authorized:
    return "authorized"
  case .denied:
    return "denied"
  case .restricted:
    return "restricted"
  case .notDetermined:
    return "not_determined"
  @unknown default:
    return "unknown_\(status.rawValue)"
  }
}

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
// 经私有 TCC.framework 探测(Developer ID 分发可用,MAS 禁用私有 SPI)
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
