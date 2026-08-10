// 扫描 Core Audio 活跃进程与可用输入设备

import CoreAudio

/// 查询 Core Audio 当前的活跃进程与可用输入设备
struct AudioProcessScanner {
  private let metadataResolver = ProcessMetadataResolver()

  func scanProcesses() -> [AudioProcessInfo] {
    objectIDs(selector: kAudioHardwarePropertyProcessObjectList).compactMap { processID in
      let pid = processPID(processID)
      guard pid > 0 else { return nil }

      let isRunningInput = boolProperty(processID, kAudioProcessPropertyIsRunningInput)
      let isRunningOutput = boolProperty(processID, kAudioProcessPropertyIsRunningOutput)
      guard isRunningInput || isRunningOutput else { return nil }

      let metadata = metadataResolver.resolve(pid: pid)
      return AudioProcessInfo(
        pid: pid,
        name: metadata.name,
        bundleId: metadata.bundleId,
        executablePath: metadata.executablePath,
        isRunningInput: isRunningInput,
        isRunningOutput: isRunningOutput
      )
    }
  }

  func inputDeviceIDs() -> [AudioObjectID] {
    objectIDs(selector: kAudioHardwarePropertyDevices).filter(hasInputChannels)
  }

  private func objectIDs(selector: AudioObjectPropertySelector) -> [AudioObjectID] {
    var address = AudioObjectPropertyAddress(
      mSelector: selector,
      mScope: kAudioObjectPropertyScopeGlobal,
      mElement: kAudioObjectPropertyElementMain
    )
    var dataSize: UInt32 = 0
    let systemObject = AudioObjectID(kAudioObjectSystemObject)

    guard AudioObjectGetPropertyDataSize(systemObject, &address, 0, nil, &dataSize) == noErr else {
      return []
    }

    let count = Int(dataSize) / MemoryLayout<AudioObjectID>.size
    guard count > 0 else { return [] }

    var objectIDs = [AudioObjectID](repeating: 0, count: count)
    let status = objectIDs.withUnsafeMutableBytes { storage -> OSStatus in
      guard let baseAddress = storage.baseAddress else { return kAudioHardwareUnspecifiedError }
      return AudioObjectGetPropertyData(systemObject, &address, 0, nil, &dataSize, baseAddress)
    }
    guard status == noErr else { return [] }

    let resultCount = min(Int(dataSize) / MemoryLayout<AudioObjectID>.size, objectIDs.count)
    return Array(objectIDs.prefix(resultCount))
  }

  private func processPID(_ objectID: AudioObjectID) -> Int {
    var address = AudioObjectPropertyAddress(
      mSelector: kAudioProcessPropertyPID,
      mScope: kAudioObjectPropertyScopeGlobal,
      mElement: kAudioObjectPropertyElementMain
    )
    var pid: pid_t = 0
    var size = UInt32(MemoryLayout<pid_t>.size)
    guard AudioObjectGetPropertyData(objectID, &address, 0, nil, &size, &pid) == noErr else {
      return -1
    }
    return Int(pid)
  }

  private func boolProperty(
    _ objectID: AudioObjectID,
    _ selector: AudioObjectPropertySelector
  ) -> Bool {
    var address = AudioObjectPropertyAddress(
      mSelector: selector,
      mScope: kAudioObjectPropertyScopeGlobal,
      mElement: kAudioObjectPropertyElementMain
    )
    var value: UInt32 = 0
    var size = UInt32(MemoryLayout<UInt32>.size)
    guard AudioObjectGetPropertyData(objectID, &address, 0, nil, &size, &value) == noErr else {
      return false
    }
    return value != 0
  }

  private func hasInputChannels(_ deviceID: AudioObjectID) -> Bool {
    var address = AudioObjectPropertyAddress(
      mSelector: kAudioDevicePropertyStreamConfiguration,
      mScope: kAudioObjectPropertyScopeInput,
      mElement: kAudioObjectPropertyElementMain
    )
    var dataSize: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(deviceID, &address, 0, nil, &dataSize) == noErr,
          dataSize >= MemoryLayout<AudioBufferList>.size else {
      return false
    }

    let storage = UnsafeMutableRawPointer.allocate(
      byteCount: Int(dataSize),
      alignment: MemoryLayout<AudioBufferList>.alignment
    )
    defer { storage.deallocate() }

    guard AudioObjectGetPropertyData(deviceID, &address, 0, nil, &dataSize, storage) == noErr,
          dataSize >= MemoryLayout<AudioBufferList>.size else {
      return false
    }

    let bufferList = storage.bindMemory(to: AudioBufferList.self, capacity: 1)
    return UnsafeMutableAudioBufferListPointer(bufferList).contains { $0.mNumberChannels > 0 }
  }
}
