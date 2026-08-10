// 将崩溃或停止时遗留的麦克风 sidecar 安全混回主录音文件

import CoreMedia
import Foundation

func recoverMicSidecar(sidecarPath: String, outputPath: String) async -> Bool {
  let fm = FileManager.default
  let sidecarURL = URL(fileURLWithPath: sidecarPath)
  let outputURL = URL(fileURLWithPath: outputPath)

  guard fm.fileExists(atPath: sidecarURL.path) else {
    log("mic sidecar recovery: missing sidecar \(sidecarPath)")
    return false
  }

  let sidecarDuration = await readableAudioDuration(sidecarURL)
  guard sidecarDuration > .zero else {
    log("mic sidecar recovery: unusable sidecar \(sidecarURL.lastPathComponent)")
    return false
  }

  /**
   * outputPath 可能是崩溃留下的不可播主文件、checkpoint 恢复出的系统音文件，
   * 或完全不存在。mixTracks 会跳过不可读输入，并把 sidecar 作为额外输入混入；
   * 因此这里统一走它，保证最终仍是正常 m4a。
   */
  /**
   * 崩溃后没有正常 stop 阶段的 hasDetectedSignal 快照，不能只因 sidecar 存在
   * 就降低可用的系统音。恢复路径因此保留主轨原增益
   */
  guard await mixTracks(inputPath: outputPath, extraInputPaths: [sidecarPath]) else {
    log("mic sidecar recovery: mix failed for \(sidecarURL.lastPathComponent)")
    return false
  }

  let outputDuration = await readableAudioDuration(outputURL)
  guard outputDuration > .zero else {
    log("mic sidecar recovery: output unreadable after mix \(outputURL.lastPathComponent)")
    return false
  }

  consumeMicSidecarFile(sidecarURL, context: "mic sidecar recovery")
  log("mic sidecar recovery: success \(sidecarURL.lastPathComponent) -> \(outputURL.lastPathComponent) (\(outputDuration.seconds)s)")
  return true
}

func consumeMicSidecarFile(_ sidecarURL: URL, context: String) {
  let mergedURL = sidecarURL.appendingPathExtension("merged")
  do {
    try? FileManager.default.removeItem(at: mergedURL)
    try FileManager.default.moveItem(at: sidecarURL, to: mergedURL)
    try? FileManager.default.removeItem(at: mergedURL)
  }
  catch {
    log("\(context): sidecar consume failed \(sidecarURL.lastPathComponent): \(describeError(error))")
  }
}
