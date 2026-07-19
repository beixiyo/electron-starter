import Cocoa
import CoreAudio

/// 常驻进程：监听 CoreAudio 音频进程列表变化，输出 JSON 事件到 stdout
/// macOS 14.2+ 使用 kAudioHardwarePropertyProcessObjectList
/// 每行输出一个 JSON 数组，包含当前所有活跃音频进程
///
/// Usage: audio-monitor [--interval <seconds>]
///   --interval  轮询间隔秒数（默认 3）

var pollInterval: Double = 3

for i in 1..<CommandLine.arguments.count {
  if CommandLine.arguments[i] == "--interval", i + 1 < CommandLine.arguments.count,
     let val = Double(CommandLine.arguments[i + 1]), val > 0 {
    pollInterval = val
  }
}

struct AudioProcessInfo {
  let pid: Int
  let name: String
  let bundleId: String
  let isRunningInput: Bool
  let isRunningOutput: Bool
}

func getAudioProcesses() -> [AudioProcessInfo] {
  var address = AudioObjectPropertyAddress(
    mSelector: kAudioHardwarePropertyProcessObjectList,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
  )

  var dataSize: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(
    AudioObjectID(kAudioObjectSystemObject),
    &address, 0, nil, &dataSize
  ) == noErr else { return [] }

  let count = Int(dataSize) / MemoryLayout<AudioObjectID>.size
  guard count > 0 else { return [] }

  var processIDs = [AudioObjectID](repeating: 0, count: count)
  guard AudioObjectGetPropertyData(
    AudioObjectID(kAudioObjectSystemObject),
    &address, 0, nil, &dataSize, &processIDs
  ) == noErr else { return [] }

  var results: [AudioProcessInfo] = []

  for processID in processIDs {
    let pid = getProcessPID(processID)
    guard pid > 0 else { continue }

    let isInput = getBoolProperty(processID, kAudioProcessPropertyIsRunningInput)
    let isOutput = getBoolProperty(processID, kAudioProcessPropertyIsRunningOutput)

    guard isInput || isOutput else { continue }

    let (name, bundleId) = resolveProcessInfo(pid: pid)

    results.append(AudioProcessInfo(
      pid: pid,
      name: name,
      bundleId: bundleId,
      isRunningInput: isInput,
      isRunningOutput: isOutput
    ))
  }

  return results
}

func getProcessPID(_ objectID: AudioObjectID) -> Int {
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

func getBoolProperty(_ objectID: AudioObjectID, _ selector: AudioObjectPropertySelector) -> Bool {
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

func resolveProcessInfo(pid: Int) -> (name: String, bundleId: String) {
  if let app = NSRunningApplication(processIdentifier: pid_t(pid)) {
    let name = app.localizedName ?? "pid-\(pid)"
    let bundleId = app.bundleIdentifier ?? ""
    return (name, bundleId)
  }

  let maxPathSize = 4 * Int(MAXPATHLEN)
  var pathBuffer = [CChar](repeating: 0, count: maxPathSize)
  let pathLength = proc_pidpath(pid_t(pid), &pathBuffer, UInt32(maxPathSize))
  if pathLength > 0 {
    let fullPath = String(cString: pathBuffer)
    let name = (fullPath as NSString).lastPathComponent
    return (name, "")
  }

  return ("pid-\(pid)", "")
}

func escapeJSON(_ s: String) -> String {
  return s
    .replacingOccurrences(of: "\\", with: "\\\\")
    .replacingOccurrences(of: "\"", with: "\\\"")
    .replacingOccurrences(of: "\n", with: "\\n")
    .replacingOccurrences(of: "\r", with: "\\r")
    .replacingOccurrences(of: "\t", with: "\\t")
}

var lastOutput = ""

func outputProcesses(_ processes: [AudioProcessInfo]) {
  var entries: [String] = []
  for p in processes {
    let entry = "{\"pid\":\(p.pid),\"name\":\"\(escapeJSON(p.name))\",\"bundleId\":\"\(escapeJSON(p.bundleId))\",\"isRunningInput\":\(p.isRunningInput),\"isRunningOutput\":\(p.isRunningOutput)}"
    entries.append(entry)
  }
  let json = "[" + entries.joined(separator: ",") + "]"
  guard json != lastOutput else { return }
  lastOutput = json
  print(json)
  if fflush(stdout) != 0 {
    exit(0)
  }
}

func poll() {
  let processes = getAudioProcesses()
  outputProcesses(processes)
}

// ── 监听 1：进程列表变化（新进程注册/注销 CoreAudio）
var processListAddress = AudioObjectPropertyAddress(
  mSelector: kAudioHardwarePropertyProcessObjectList,
  mScope: kAudioObjectPropertyScopeGlobal,
  mElement: kAudioObjectPropertyElementMain
)

AudioObjectAddPropertyListenerBlock(
  AudioObjectID(kAudioObjectSystemObject),
  &processListAddress,
  DispatchQueue.main
) { _, _ in poll() }

// ── 监听 2：麦克风使用状态变化（已注册进程开始/停止用麦克风）
func getInputDeviceIDs() -> [AudioObjectID] {
  var address = AudioObjectPropertyAddress(
    mSelector: kAudioHardwarePropertyDevices,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
  )
  var dataSize: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(
    AudioObjectID(kAudioObjectSystemObject),
    &address, 0, nil, &dataSize
  ) == noErr else { return [] }

  let count = Int(dataSize) / MemoryLayout<AudioObjectID>.size
  guard count > 0 else { return [] }

  var deviceIDs = [AudioObjectID](repeating: 0, count: count)
  guard AudioObjectGetPropertyData(
    AudioObjectID(kAudioObjectSystemObject),
    &address, 0, nil, &dataSize, &deviceIDs
  ) == noErr else { return [] }

  // 只保留有输入通道的设备（麦克风）
  return deviceIDs.filter { deviceID in
    var inputAddress = AudioObjectPropertyAddress(
      mSelector: kAudioDevicePropertyStreamConfiguration,
      mScope: kAudioObjectPropertyScopeInput,
      mElement: kAudioObjectPropertyElementMain
    )
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(deviceID, &inputAddress, 0, nil, &size) == noErr else {
      return false
    }
    let bufferListPtr = UnsafeMutablePointer<AudioBufferList>.allocate(capacity: 1)
    defer { bufferListPtr.deallocate() }
    guard AudioObjectGetPropertyData(deviceID, &inputAddress, 0, nil, &size, bufferListPtr) == noErr else {
      return false
    }
    return bufferListPtr.pointee.mNumberBuffers > 0
  }
}

/// 已注册设备 → listener block（移除监听须传同一 block 实例，故必须存下来配对）
var deviceListenerBlocks: [AudioObjectID: AudioObjectPropertyListenerBlock] = [:]

func makeRunningAddress() -> AudioObjectPropertyAddress {
  AudioObjectPropertyAddress(
    mSelector: kAudioDevicePropertyDeviceIsRunningSomewhere,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
  )
}

func registerDeviceListeners() {
  let inputDevices = getInputDeviceIDs()
  let currentDevices = Set(inputDevices)

  // 先摘掉已消失设备的监听：蓝牙耳机每次重连拿新 AudioObjectID，不清理会无限累积注册项
  for (deviceID, block) in deviceListenerBlocks where !currentDevices.contains(deviceID) {
    var runningAddress = makeRunningAddress()
    AudioObjectRemovePropertyListenerBlock(deviceID, &runningAddress, DispatchQueue.main, block)
    deviceListenerBlocks.removeValue(forKey: deviceID)
  }

  for deviceID in inputDevices {
    guard deviceListenerBlocks[deviceID] == nil else { continue }

    let block: AudioObjectPropertyListenerBlock = { _, _ in poll() }
    deviceListenerBlocks[deviceID] = block

    var runningAddress = makeRunningAddress()
    AudioObjectAddPropertyListenerBlock(deviceID, &runningAddress, DispatchQueue.main, block)
  }
}

registerDeviceListeners()

// ── 监听 3：音频设备热插拔（重新注册设备监听）
var deviceListAddress = AudioObjectPropertyAddress(
  mSelector: kAudioHardwarePropertyDevices,
  mScope: kAudioObjectPropertyScopeGlobal,
  mElement: kAudioObjectPropertyElementMain
)

AudioObjectAddPropertyListenerBlock(
  AudioObjectID(kAudioObjectSystemObject),
  &deviceListAddress,
  DispatchQueue.main
) { _, _ in registerDeviceListeners() }

// 忽略 SIGPIPE（父进程退出时管道断裂，不要直接崩溃）
signal(SIGPIPE, SIG_IGN)

// 定时轮询：兜底事件监听器遗漏的场景 + 检测父进程存活
let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.main)
timer.schedule(deadline: .now() + pollInterval, repeating: pollInterval)
timer.setEventHandler {
  if getppid() == 1 { exit(0) }
  poll()
}
timer.resume()

// 输出当前状态作为初始快照
poll()

// 保持进程运行
CFRunLoopRun()
