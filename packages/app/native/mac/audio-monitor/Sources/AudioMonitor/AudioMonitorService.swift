// 管理 audio-monitor 的 Core Audio 监听、轮询与成对清理

import CoreAudio
import Darwin
import Foundation

/// 管理 Core Audio 属性监听、设备监听和轮询兜底的完整生命周期
final class AudioMonitorService {
  private let pollInterval: Double
  private let scanner = AudioProcessScanner()
  private let output = AudioProcessOutput()

  private var isStarted = false
  private var timer: DispatchSourceTimer?
  private var deviceListenerBlocks: [AudioObjectID: AudioObjectPropertyListenerBlock] = [:]

  private lazy var processListListener: AudioObjectPropertyListenerBlock = { [weak self] _, _ in
    self?.poll()
  }

  private lazy var deviceListListener: AudioObjectPropertyListenerBlock = { [weak self] _, _ in
    self?.syncDeviceListeners()
  }

  init(pollInterval: Double) {
    self.pollInterval = pollInterval
  }

  deinit {
    stop()
  }

  func start() {
    guard !isStarted else { return }
    isStarted = true

    addSystemListeners()
    syncDeviceListeners()
    startTimer()
    poll()
  }

  func stop() {
    guard isStarted else { return }
    isStarted = false

    timer?.cancel()
    timer = nil

    let systemObject = AudioObjectID(kAudioObjectSystemObject)
    var processListAddress = Self.processListAddress()
    AudioObjectRemovePropertyListenerBlock(
      systemObject,
      &processListAddress,
      DispatchQueue.main,
      processListListener
    )

    var deviceListAddress = Self.deviceListAddress()
    AudioObjectRemovePropertyListenerBlock(
      systemObject,
      &deviceListAddress,
      DispatchQueue.main,
      deviceListListener
    )

    for (deviceID, listener) in deviceListenerBlocks {
      removeDeviceListener(deviceID: deviceID, listener: listener)
    }
    deviceListenerBlocks.removeAll()
  }

  private func addSystemListeners() {
    let systemObject = AudioObjectID(kAudioObjectSystemObject)

    var processListAddress = Self.processListAddress()
    AudioObjectAddPropertyListenerBlock(
      systemObject,
      &processListAddress,
      DispatchQueue.main,
      processListListener
    )

    var deviceListAddress = Self.deviceListAddress()
    AudioObjectAddPropertyListenerBlock(
      systemObject,
      &deviceListAddress,
      DispatchQueue.main,
      deviceListListener
    )
  }

  private func syncDeviceListeners() {
    let inputDevices = scanner.inputDeviceIDs()
    let currentDevices = Set(inputDevices)
    let removedDeviceIDs = deviceListenerBlocks.keys.filter { !currentDevices.contains($0) }

    for deviceID in removedDeviceIDs {
      guard let listener = deviceListenerBlocks.removeValue(forKey: deviceID) else { continue }
      removeDeviceListener(deviceID: deviceID, listener: listener)
    }

    for deviceID in inputDevices where deviceListenerBlocks[deviceID] == nil {
      let listener: AudioObjectPropertyListenerBlock = { [weak self] _, _ in
        self?.poll()
      }
      deviceListenerBlocks[deviceID] = listener

      var address = Self.deviceRunningAddress()
      AudioObjectAddPropertyListenerBlock(deviceID, &address, DispatchQueue.main, listener)
    }
  }

  private func removeDeviceListener(
    deviceID: AudioObjectID,
    listener: @escaping AudioObjectPropertyListenerBlock
  ) {
    var address = Self.deviceRunningAddress()
    AudioObjectRemovePropertyListenerBlock(deviceID, &address, DispatchQueue.main, listener)
  }

  private func startTimer() {
    let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.main)
    timer.schedule(deadline: .now() + pollInterval, repeating: pollInterval)
    timer.setEventHandler { [weak self] in
      guard getppid() != 1 else {
        self?.stop()
        exit(0)
      }
      self?.poll()
    }
    timer.resume()
    self.timer = timer
  }

  private func poll() {
    output.write(scanner.scanProcesses())
  }

  private static func processListAddress() -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(
      mSelector: kAudioHardwarePropertyProcessObjectList,
      mScope: kAudioObjectPropertyScopeGlobal,
      mElement: kAudioObjectPropertyElementMain
    )
  }

  private static func deviceListAddress() -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(
      mSelector: kAudioHardwarePropertyDevices,
      mScope: kAudioObjectPropertyScopeGlobal,
      mElement: kAudioObjectPropertyElementMain
    )
  }

  private static func deviceRunningAddress() -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(
      mSelector: kAudioDevicePropertyDeviceIsRunningSomewhere,
      mScope: kAudioObjectPropertyScopeGlobal,
      mElement: kAudioObjectPropertyElementMain
    )
  }
}
