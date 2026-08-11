// 麦克风 sidecar 事务的锁、marker 和文件系统持久化机制

import Darwin
import Foundation

/**
 * 同目录 advisory flock：文件名负责让 Node 发现遗留任务，内核锁负责阻止两个 helper
 * 同时读取/替换同一份 output。进程崩溃时 flock 自动释放，遗留 lock 文件可被下一次
 * recovery 重新取得，不依赖 PID 猜测，也不复制或删除别的进程的锁
 */
final class MicSidecarTransactionLock {
  private let descriptor: Int32
  private let lockURL: URL
  private let identity: String
  private var released = false

  init?(transaction: MicSidecarTransaction) {
    let lockURL = transaction.outputURL.appendingPathExtension("mic-lock")
    let descriptor = open(lockURL.path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
    guard descriptor >= 0 else {
      log("mic sidecar transaction: cannot open lock \(lockURL.lastPathComponent)")
      return nil
    }

    guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
      close(descriptor)
      return nil
    }

    let identity = UUID().uuidString
    let payload = "mic-sidecar-lock-v1\n\(identity)\n\(transaction.outputURL.path)\n\(transaction.sidecarURL.path)\n"
    let data = Data(payload.utf8)
    guard ftruncate(descriptor, 0) == 0,
          writeAll(data, to: descriptor)
    else {
      _ = unlink(lockURL.path)
      flock(descriptor, LOCK_UN)
      close(descriptor)
      return nil
    }

    self.descriptor = descriptor
    self.lockURL = lockURL
    self.identity = identity
  }

  func release() {
    guard !released else { return }
    released = true

    /** 仍持有 flock 时才允许清除同身份的路径，避免误删后来者的 lock 文件 */
    if let contents = try? String(contentsOf: lockURL, encoding: .utf8),
       contents.contains("\n\(identity)\n") {
      _ = unlink(lockURL.path)
    }
    else {
      log("mic sidecar transaction: lock identity changed, preserving lock file")
    }
    flock(descriptor, LOCK_UN)
    close(descriptor)
  }

  deinit {
    release()
  }
}

/** backup/marker 路径同时供 Swift 和 Node recovery 约定使用 */
func micSidecarBackupPath(for outputPath: String) -> String {
  "\(outputPath).mic-backup"
}

func micSidecarPendingPath(for outputPath: String) -> String {
  "\(outputPath).mic-pending"
}

/** 空 sidecar 没有进入混音事务时的尽力清理 */
func removeMicSidecarFile(_ sidecarURL: URL, context: String) {
  do {
    try removeRegularFileIfPresent(sidecarURL)
  }
  catch {
    log("\(context): sidecar cleanup failed \(sidecarURL.lastPathComponent): \(describeError(error))")
  }
}

func createBackupLink(from sourceURL: URL, to backupURL: URL) -> Bool {
  let fm = FileManager.default
  do {
    try? fm.removeItem(at: backupURL)
    try fm.linkItem(atPath: sourceURL.path, toPath: backupURL.path)
    guard fileSystemNumber(sourceURL) == fileSystemNumber(backupURL) else {
      log("mic sidecar transaction: backup inode mismatch")
      try? fm.removeItem(at: backupURL)
      return false
    }
    return true
  }
  catch {
    log("mic sidecar transaction: cannot create hard-link backup: \(describeError(error))")
    return false
  }
}

func writePendingMarker(_ markerURL: URL, marker: PendingMicSidecarMarker) -> Bool {
  do {
    let data = try JSONEncoder().encode(marker)
    try data.write(to: markerURL, options: .atomic)
    return true
  }
  catch {
    log("mic sidecar transaction: cannot write pending marker: \(describeError(error))")
    return false
  }
}

func readPendingMarker(_ transaction: MicSidecarTransaction) -> PendingMicSidecarMarker? {
  do {
    let marker = try JSONDecoder().decode(
      PendingMicSidecarMarker.self,
      from: Data(contentsOf: transaction.pendingURL)
    )
    guard marker.version == 1,
          marker.outputPath == transaction.outputURL.path,
          marker.sidecarPath == transaction.sidecarURL.path,
          marker.primaryInputVolume.isFinite,
          marker.primaryInputVolume >= .zero,
          marker.primaryInputVolume <= 1,
          marker.timeline.allSatisfy(isValidPendingTimelineSegment)
    else { return nil }
    return marker
  }
  catch {
    log("mic sidecar transaction: cannot read pending marker: \(describeError(error))")
    return nil
  }
}

func fileSystemNumber(_ url: URL) -> UInt64? {
  guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
        let number = attributes[.systemFileNumber] as? NSNumber
  else { return nil }
  return number.uint64Value
}

func isRegularFile(_ url: URL) -> Bool {
  guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path) else {
    return false
  }
  return attributes[.type] as? FileAttributeType == .typeRegular
}

func removeRegularFileIfPresent(_ url: URL) throws {
  let fm = FileManager.default
  guard fm.fileExists(atPath: url.path) else { return }
  guard isRegularFile(url) else {
    throw mixerError("expected regular file: \(url.lastPathComponent)")
  }
  try fm.removeItem(at: url)
}

private func writeAll(_ data: Data, to descriptor: Int32) -> Bool {
  data.withUnsafeBytes { rawBuffer in
    guard let baseAddress = rawBuffer.baseAddress else { return true }
    var offset = 0
    while offset < rawBuffer.count {
      let written = Darwin.write(
        descriptor,
        baseAddress.advanced(by: offset),
        rawBuffer.count - offset
      )
      guard written > 0 else { return false }
      offset += written
    }
    return true
  }
}
