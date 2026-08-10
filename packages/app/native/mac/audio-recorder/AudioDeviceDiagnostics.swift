// 读取默认音频设备拓扑，供录音引擎保留可追溯的故障环境

import CoreAudio
import Foundation

/** 返回默认输入和输出设备的名称、采样率及传输类型，读取失败时返回错误码占位 */
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
