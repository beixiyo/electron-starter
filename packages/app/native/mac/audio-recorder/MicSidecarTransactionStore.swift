// 麦克风 sidecar 事务的锁、marker 和文件系统持久化机制

import Darwin
import Foundation

/**
 * 同目录 advisory flock：文件名负责让 Node 发现遗留任务，内核锁负责阻止两个 helper
 * 同时读取/替换同一份 output。lock 文件 inode 永久保留，进程崩溃时 flock 自动释放，
 * 下一次 recovery 重新打开同一个 inode；不在 release 时 unlink，避免旧 fd 解锁前被
 * 新 helper 创建同名文件并取得另一把 flock
 */
final class MicSidecarTransactionLock {
  private let descriptor: Int32
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
      flock(descriptor, LOCK_UN)
      close(descriptor)
      return nil
    }

    self.descriptor = descriptor
  }

  func release() {
    guard !released else { return }
    released = true

    /** lock inode 永久保留；只释放内核锁，不删除路径，避免 unlink/recreate 竞态 */
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
    try syncFileContents(at: markerURL)
    try syncContainingDirectory(of: markerURL)
    return true
  }
  catch {
    log("mic sidecar transaction: cannot write pending marker: \(describeError(error))")
    return false
  }
}

/** 将已关闭的文件内容推进到文件系统，避免 marker/临时音频只停留在缓存中 */
func syncFileContents(at url: URL) throws {
  let descriptor = open(url.path, O_RDONLY)
  guard descriptor >= 0 else {
    throw fileSystemSyncError("cannot open file for sync", url: url)
  }
  defer { close(descriptor) }
  try syncDescriptor(descriptor, url: url)
}

/** 将同目录 rename 的目录项推进到文件系统；只接受目录 fd，不跟随目标文件 */
func syncContainingDirectory(of url: URL) throws {
  let directoryURL = url.deletingLastPathComponent()
  let descriptor = open(directoryURL.path, O_RDONLY)
  guard descriptor >= 0 else {
    throw fileSystemSyncError("cannot open directory for sync", url: directoryURL)
  }
  defer { close(descriptor) }
  try syncDescriptor(descriptor, url: directoryURL)
}

private func syncDescriptor(_ descriptor: Int32, url: URL) throws {
  while Darwin.fsync(descriptor) != 0 {
    if errno == EINTR { continue }
    throw fileSystemSyncError("fsync failed", url: url)
  }
}

private func fileSystemSyncError(_ message: String, url: URL) -> NSError {
  NSError(
    domain: NSPOSIXErrorDomain,
    code: Int(errno),
    userInfo: [NSLocalizedDescriptionKey: "\(message): \(url.path)"]
  )
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
