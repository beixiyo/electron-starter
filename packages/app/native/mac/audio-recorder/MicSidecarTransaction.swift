// 麦克风 sidecar 混音事务的状态机与恢复判定

import CoreMedia
import Foundation

/**
 * sidecar 混音事务的同目录资产
 *
 * backup 是 output 的 hard link，不复制音频内容。混音前两者 inode 相同，
 * mixTracks 用同目录临时文件 rename 覆盖 output 后 inode 必然不同，因此重启时
 * 不需要猜测上一次是否已经混过
 */
struct MicSidecarTransaction {
  let sidecarURL: URL
  let outputURL: URL
  let backupURL: URL
  let pendingURL: URL
}

enum MicSidecarTransactionState {
  case pending
  case committed
}

struct PreparedMicSidecarTransaction {
  let state: MicSidecarTransactionState
  let primaryInputVolume: Float
  let primaryTimelineSegments: [AudioTimelineSegment]
}

struct PendingMicSidecarMarker: Codable {
  let version: Int
  let outputPath: String
  let sidecarPath: String
  let hadPrimaryFile: Bool
  let primaryInputVolume: Float
  let timeline: [PendingMicTimelineSegment]
}

struct PendingMicTimelineSegment: Codable {
  let startValue: Int64
  let startTimescale: Int32
  let durationValue: Int64
  let durationTimescale: Int32
}

/**
 * 根据 marker、backup 和 output 的当前关系恢复事务状态。
 *
 * marker-first、hard-link inode 判定和 missing-primary 分支都在这里集中处理；
 * 调用方只拿到 pending/committed 结果后决定是否继续混音或校验。
 */
func prepareMicSidecarTransaction(
  _ transaction: MicSidecarTransaction,
  primaryInputVolume: Float,
  primaryTimelineSegments: [AudioTimelineSegment]
) async -> PreparedMicSidecarTransaction? {
  let fm = FileManager.default
  let outputExists = fm.fileExists(atPath: transaction.outputURL.path)
  let backupExists = fm.fileExists(atPath: transaction.backupURL.path)
  let pendingExists = fm.fileExists(atPath: transaction.pendingURL.path)
  let marker: PendingMicSidecarMarker?
  if pendingExists {
    marker = readPendingMarker(transaction)
  }
  else if backupExists {
    /** marker-first 协议不能从 backup 猜恢复时的音量和时间轴参数 */
    log("mic sidecar transaction: backup exists without pending marker")
    return nil
  }
  else {
    marker = makePendingMarker(
      hadPrimaryFile: outputExists,
      transaction: transaction,
      primaryInputVolume: primaryInputVolume,
      primaryTimelineSegments: primaryTimelineSegments
    )
  }

  guard let marker else {
    if pendingExists {
      log("mic sidecar transaction: invalid pending marker")
    }
    return nil
  }
  let restoredTimeline = marker.timeline.compactMap(toAudioTimelineSegment)
  guard restoredTimeline.count == marker.timeline.count else {
    log("mic sidecar transaction: invalid pending timeline")
    return nil
  }

  if backupExists {
    guard marker.hadPrimaryFile else {
      log("mic sidecar transaction: backup exists for missing-primary marker")
      return nil
    }
    guard outputExists,
          let outputInode = fileSystemNumber(transaction.outputURL),
          let backupInode = fileSystemNumber(transaction.backupURL)
    else {
      log("mic sidecar transaction: backup exists but primary output is missing or unstatable")
      return nil
    }

    if outputInode == backupInode {
      /** backup 尚未提交新的 output，保留 marker 参数并重试混音 */
      return PreparedMicSidecarTransaction(
        state: .pending,
        primaryInputVolume: marker.primaryInputVolume,
        primaryTimelineSegments: restoredTimeline
      )
    }

    /** output inode 已变化，只能在媒体可读时认定 rename 已提交 */
    guard await isReadableOutput(transaction.outputURL) else {
      log("mic sidecar transaction: changed primary output is unreadable")
      return nil
    }
    return PreparedMicSidecarTransaction(
      state: .committed,
      primaryInputVolume: marker.primaryInputVolume,
      primaryTimelineSegments: restoredTimeline
    )
  }

  if pendingExists {
    if marker.hadPrimaryFile, !backupExists {
      guard isRegularFile(transaction.sidecarURL) else {
        guard await isReadableOutput(transaction.outputURL) else {
          log("mic sidecar transaction: committed output is unreadable")
          return nil
        }
        return PreparedMicSidecarTransaction(
          state: .committed,
          primaryInputVolume: marker.primaryInputVolume,
          primaryTimelineSegments: restoredTimeline
        )
      }
      /** marker 先于 hard link 落盘时可能在 backup 前崩溃；补建 hard link 后再混音 */
      guard outputExists,
            createBackupLink(from: transaction.outputURL, to: transaction.backupURL)
      else {
        log("mic sidecar transaction: primary marker exists but backup is missing")
        return nil
      }
      return PreparedMicSidecarTransaction(
        state: .pending,
        primaryInputVolume: marker.primaryInputVolume,
        primaryTimelineSegments: restoredTimeline
      )
    }

    if outputExists {
      /** missing-primary 事务完成后的清理窗口：output 可读即已提交 */
      guard await isReadableOutput(transaction.outputURL) else {
        log("mic sidecar transaction: marked output is unreadable")
        return nil
      }
      return PreparedMicSidecarTransaction(
        state: .committed,
        primaryInputVolume: marker.primaryInputVolume,
        primaryTimelineSegments: restoredTimeline
      )
    }

    /** missing-primary marker 还没有对应 output，仍需用 sidecar 生成主文件 */
    return PreparedMicSidecarTransaction(
      state: .pending,
      primaryInputVolume: marker.primaryInputVolume,
      primaryTimelineSegments: restoredTimeline
    )
  }

  /** marker 先落盘，保证参数先于硬链接持久化；硬链接失败则按安全失败处理 */
  guard writePendingMarker(transaction.pendingURL, marker: marker) else {
    return nil
  }
  if outputExists,
     !createBackupLink(from: transaction.outputURL, to: transaction.backupURL) {
    return nil
  }
  return PreparedMicSidecarTransaction(
    state: .pending,
    primaryInputVolume: marker.primaryInputVolume,
    primaryTimelineSegments: restoredTimeline
  )
}

/** 混音返回后只根据文件身份和可读性推进事务状态 */
func isCommittedAfterMix(_ transaction: MicSidecarTransaction) async -> Bool {
  let fm = FileManager.default
  guard fm.fileExists(atPath: transaction.outputURL.path) else { return false }

  if fm.fileExists(atPath: transaction.backupURL.path) {
    guard let outputInode = fileSystemNumber(transaction.outputURL),
          let backupInode = fileSystemNumber(transaction.backupURL)
    else { return false }
    return outputInode != backupInode
  }

  /** missing-primary 事务没有 backup，output 可读即表示 rename 已提交 */
  guard fm.fileExists(atPath: transaction.pendingURL.path) else { return false }
  return await isReadableOutput(transaction.outputURL)
}

/**
 * 混音尚未提交时撤销本次事务，让下一次扫描可以先恢复 checkpoint 再重试 sidecar。
 * 只有 backup/output inode 仍相同，或 missing-primary output 仍不存在时才允许回滚；
 * inode 已变化代表 rename 已提交，即使后续校验失败也必须保留事务证据，绝不能覆盖。
 */
func rollbackPendingMicSidecarTransaction(_ transaction: MicSidecarTransaction) {
  let fm = FileManager.default
  let backupExists = fm.fileExists(atPath: transaction.backupURL.path)
  let pendingExists = fm.fileExists(atPath: transaction.pendingURL.path)
  guard pendingExists || backupExists else { return }

  if backupExists {
    guard let outputInode = fileSystemNumber(transaction.outputURL),
          let backupInode = fileSystemNumber(transaction.backupURL),
          outputInode == backupInode
    else {
      log("mic sidecar transaction: rollback refused after output inode changed")
      return
    }
  }
  else {
    guard let marker = readPendingMarker(transaction),
          !marker.hadPrimaryFile,
          !fm.fileExists(atPath: transaction.outputURL.path)
    else {
      log("mic sidecar transaction: rollback refused without missing-primary proof")
      return
    }
  }

  do {
    try removeRegularFileIfPresent(transaction.backupURL)
    try removeRegularFileIfPresent(transaction.pendingURL)
    log("mic sidecar transaction: rolled back pending transaction")
  }
  catch {
    log("mic sidecar transaction: rollback failed: \(describeError(error))")
  }
}

private func makePendingMarker(
  hadPrimaryFile: Bool,
  transaction: MicSidecarTransaction,
  primaryInputVolume: Float,
  primaryTimelineSegments: [AudioTimelineSegment]
) -> PendingMicSidecarMarker? {
  guard primaryInputVolume.isFinite, primaryInputVolume >= .zero, primaryInputVolume <= 1 else {
    log("mic sidecar transaction: invalid primary volume \(primaryInputVolume)")
    return nil
  }
  guard primaryTimelineSegments.allSatisfy({ segment in
    segment.start.isNumeric
      && segment.start >= .zero
      && segment.duration.isNumeric
      && segment.duration > .zero
  }) else {
    log("mic sidecar transaction: invalid primary timeline")
    return nil
  }

  let timeline = primaryTimelineSegments.map { segment in
    PendingMicTimelineSegment(
      startValue: segment.start.value,
      startTimescale: segment.start.timescale,
      durationValue: segment.duration.value,
      durationTimescale: segment.duration.timescale
    )
  }
  return PendingMicSidecarMarker(
    version: 1,
    outputPath: transaction.outputURL.path,
    sidecarPath: transaction.sidecarURL.path,
    hadPrimaryFile: hadPrimaryFile,
    primaryInputVolume: primaryInputVolume,
    timeline: timeline
  )
}

func isValidPendingTimelineSegment(_ segment: PendingMicTimelineSegment) -> Bool {
  segment.startValue >= 0
    && segment.startTimescale > 0
    && segment.durationTimescale > 0
    && segment.durationValue > 0
}

private func toAudioTimelineSegment(_ segment: PendingMicTimelineSegment) -> AudioTimelineSegment? {
  guard isValidPendingTimelineSegment(segment) else { return nil }
  let start = CMTime(value: segment.startValue, timescale: segment.startTimescale)
  let duration = CMTime(value: segment.durationValue, timescale: segment.durationTimescale)
  guard start.isNumeric, start >= .zero, duration.isNumeric, duration > .zero else { return nil }
  return AudioTimelineSegment(start: start, duration: duration)
}
