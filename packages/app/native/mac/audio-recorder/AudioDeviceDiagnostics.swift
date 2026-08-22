// 读取默认音频设备拓扑，供录音引擎保留可追溯的故障环境

import CoreAudio
import Foundation

/** 当前默认输入设备的进程内快速路径匹配键；任一硬件属性变化都会自然错过旧策略 */
struct DefaultInputDeviceFingerprint: Hashable {
  let uid: String
  let sampleRate: UInt64
  let transport: UInt32

  /** 跨 helper 代际回传给主进程的内存提示键；不落盘、不写诊断日志 */
  var cacheKey: String {
    let encodedUID = Data(uid.utf8).base64EncodedString()
    return "\(encodedUID)|\(sampleRate)|\(transport)"
  }
}

/** 返回默认输入和输出设备的名称、采样率及传输类型，读取失败时返回错误码占位 */
func describeDefaultAudioDevices() -> String {
  "in=\(describeDefaultDevice(selector: kAudioHardwarePropertyDefaultInputDevice)) out=\(describeDefaultDevice(selector: kAudioHardwarePropertyDefaultOutputDevice))"
}

/** 读取当前系统默认输入设备身份，不枚举设备、不打开麦克风，失败时禁用本次快速路径 */
func getDefaultInputDeviceFingerprint() -> DefaultInputDeviceFingerprint? {
  guard let deviceID = readDefaultDeviceID(selector: kAudioHardwarePropertyDefaultInputDevice),
        let uid = readDeviceCFString(deviceID, selector: kAudioDevicePropertyDeviceUID),
        let sampleRate = readDeviceSampleRate(deviceID),
        let transport = readDeviceTransportValue(deviceID)
  else {
    return nil
  }

  return DefaultInputDeviceFingerprint(
    uid: uid,
    sampleRate: sampleRate.bitPattern,
    transport: transport
  )
}

/**
 * 默认输出设备的传输类型，取值同 `readDeviceTransport`（builtin / bluetooth / usb ...）
 *
 * 用途:判断本场录音有没有外放回声风险。实测在 builtin 扬声器 + 无 AEC 时，对端声音会以
 * 约 124ms 延迟漏进麦克风，占麦克风轨约 78% 能量;戴耳机则不存在该路径
 * 只读传输类型不读设备名，避免把用户设备名写进日志
 */
func getDefaultOutputTransport() -> String? {
  guard let deviceID = readDefaultDeviceID(selector: kAudioHardwarePropertyDefaultOutputDevice)
  else { return nil }
  return readDeviceTransport(deviceID)
}

private func describeDefaultDevice(selector: AudioObjectPropertySelector) -> String {
  guard let deviceID = readDefaultDeviceID(selector: selector) else {
    return "<unavailable>"
  }

  let name = readDeviceCFString(deviceID, selector: kAudioObjectPropertyName) ?? "<unnamed>"
  let rate = readDeviceSampleRate(deviceID).map { "\(Int($0))Hz" } ?? "?Hz"
  return "\"\(name)\" (\(rate), \(readDeviceTransport(deviceID)))"
}

private func readDefaultDeviceID(selector: AudioObjectPropertySelector) -> AudioObjectID? {
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
    return nil
  }
  return deviceID
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
  guard let transport = readDeviceTransportValue(deviceID) else { return "transport?" }

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

private func readDeviceTransportValue(_ deviceID: AudioObjectID) -> UInt32? {
  var address = AudioObjectPropertyAddress(
    mSelector: kAudioDevicePropertyTransportType,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
  )
  var transport: UInt32 = 0
  var size = UInt32(MemoryLayout<UInt32>.size)
  let err = AudioObjectGetPropertyData(deviceID, &address, 0, nil, &size, &transport)
  guard err == noErr else { return nil }
  return transport
}
