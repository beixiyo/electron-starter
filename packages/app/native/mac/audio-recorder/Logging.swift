import AVFoundation
import Cocoa
import CoreAudio
import CoreGraphics
import CoreMedia
import ScreenCaptureKit

// ── stdout JSON(SCK 与 tap 两个引擎共用) ──

func emitStatus(_ status: String, path: String, duration: Double? = nil) {
  var json = "{\"status\":\"\(status)\",\"path\":\"\(escapeJSON(path))\""
  if let d = duration {
    json += ",\"duration\":\(String(format: "%.1f", d))"
  }
  json += "}"
  print(json)
  fflush(stdout)
}

/**
 * 非致命诊断事件:走 status 通道下发。
 *
 * 刻意不用 emitError——TS 侧对未白名单的 error code 会重置录音状态机(经 discard 链路删已录音频),
 * 而未知 status 是安全忽略;需要产品层持久化 / 提示的降级信号(如 mic 掉线未能自愈)由 TS 显式加分支消费
 */
func emitDiagnostic(_ status: String, detail: String) {
  let json = "{\"status\":\"\(escapeJSON(status))\",\"detail\":\"\(escapeJSON(detail))\"}"
  print(json)
  fflush(stdout)
}

func emitError(_ error: String, detail: String? = nil) {
  var json = "{\"error\":\"\(escapeJSON(error))\""
  if let detail {
    json += ",\"detail\":\"\(escapeJSON(detail))\""
  }
  json += "}"
  print(json)
  fflush(stdout)
}

/** NSError 展开为 domain#code(+underlying),writer 失败等诊断必须带错误码落盘,localizedDescription 只有通用文案无法定位根因 */
func describeError(_ error: Error?) -> String {
  guard let error else { return "unknown" }
  let ns = error as NSError
  var desc = "\(ns.domain)#\(ns.code): \(ns.localizedDescription)"
  if let underlying = ns.userInfo[NSUnderlyingErrorKey] as? NSError {
    desc += " underlying=\(underlying.domain)#\(underlying.code)"
  }
  return desc
}

// ── 设备拓扑快照(两引擎开录时落盘,虚拟声卡 / 聚合设备是 VPIO 无样本类故障的关键环境因素) ──

/** 默认输入 / 输出设备一行描述:名称 + 采样率 + 传输类型,读取失败返回错误码占位不抛错 */
func describeDefaultAudioDevices() -> String {
  "in=\(describeDefaultDevice(selector: kAudioHardwarePropertyDefaultInputDevice)) out=\(describeDefaultDevice(selector: kAudioHardwarePropertyDefaultOutputDevice))"
}

private func describeDefaultDevice(selector: AudioObjectPropertySelector) -> String {
  var address = AudioObjectPropertyAddress(
    mSelector: selector,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
  )
  var deviceID = AudioObjectID(kAudioObjectUnknown)
  var dataSize = UInt32(MemoryLayout<AudioObjectID>.size)
  let err = AudioObjectGetPropertyData(
    AudioObjectID(kAudioObjectSystemObject),
    &address, 0, nil, &dataSize, &deviceID
  )
  guard err == noErr, deviceID != AudioObjectID(kAudioObjectUnknown) else {
    return "<unavailable_\(err)>"
  }

  let name = readDeviceCFString(deviceID, selector: kAudioObjectPropertyName) ?? "<unnamed>"
  let rate = readDeviceSampleRate(deviceID).map { "\(Int($0))Hz" } ?? "?Hz"
  return "\"\(name)\" (\(rate), \(readDeviceTransport(deviceID)))"
}

private func readDeviceCFString(_ deviceID: AudioObjectID, selector: AudioObjectPropertySelector) -> String? {
  var address = AudioObjectPropertyAddress(
    mSelector: selector,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
  )
  var value: CFString = "" as CFString
  var size = UInt32(MemoryLayout<CFString>.size)
  let err = withUnsafeMutablePointer(to: &value) { ptr in
    AudioObjectGetPropertyData(deviceID, &address, 0, nil, &size, ptr)
  }
  guard err == noErr else { return nil }
  return value as String
}

private func readDeviceSampleRate(_ deviceID: AudioObjectID) -> Double? {
  var address = AudioObjectPropertyAddress(
    mSelector: kAudioDevicePropertyNominalSampleRate,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
  )
  var rate: Float64 = 0
  var size = UInt32(MemoryLayout<Float64>.size)
  let err = AudioObjectGetPropertyData(deviceID, &address, 0, nil, &size, &rate)
  guard err == noErr, rate > 0 else { return nil }
  return rate
}

private func readDeviceTransport(_ deviceID: AudioObjectID) -> String {
  var address = AudioObjectPropertyAddress(
    mSelector: kAudioDevicePropertyTransportType,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
  )
  var transport: UInt32 = 0
  var size = UInt32(MemoryLayout<UInt32>.size)
  let err = AudioObjectGetPropertyData(deviceID, &address, 0, nil, &size, &transport)
  guard err == noErr else { return "transport?" }

  switch transport {
  case kAudioDeviceTransportTypeBuiltIn: return "builtin"
  case kAudioDeviceTransportTypeVirtual: return "virtual"
  case kAudioDeviceTransportTypeAggregate: return "aggregate"
  case kAudioDeviceTransportTypeBluetooth, kAudioDeviceTransportTypeBluetoothLE: return "bluetooth"
  case kAudioDeviceTransportTypeUSB: return "usb"
  case kAudioDeviceTransportTypeHDMI: return "hdmi"
  case kAudioDeviceTransportTypeDisplayPort: return "displayport"
  case kAudioDeviceTransportTypeAirPlay: return "airplay"
  case kAudioDeviceTransportTypeThunderbolt: return "thunderbolt"
  default: return String(format: "transport_0x%08x", transport)
  }
}


func escapeJSON(_ s: String) -> String {
  s.replacingOccurrences(of: "\\", with: "\\\\")
   .replacingOccurrences(of: "\"", with: "\\\"")
   .replacingOccurrences(of: "\n", with: "\\n")
}

func log(_ msg: String) {
  FileHandle.standardError.write("[\(msg)]\n".data(using: .utf8)!)
}

func formatCMTimeSeconds(_ time: CMTime) -> String {
  guard time.isValid, time.seconds.isFinite else { return "invalid" }
  return String(format: "%.6f", time.seconds)
}
