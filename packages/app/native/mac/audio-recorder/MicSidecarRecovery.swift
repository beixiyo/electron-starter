// 将麦克风 sidecar 安全混回主录音文件，并在业务导入成功前保留恢复资产

import AVFoundation
import CoreMedia
import Foundation

/** CLI 与正常 stop 共用的 sidecar 混音入口 */
func mergeMicSidecar(
  sidecarPath: String,
  outputPath: String,
  primaryInputVolume: Float = 1,
  primaryTimelineSegments: [AudioTimelineSegment] = []
) async -> Bool {
  let transaction = MicSidecarTransaction(
    sidecarURL: URL(fileURLWithPath: sidecarPath),
    outputURL: URL(fileURLWithPath: outputPath),
    backupURL: URL(fileURLWithPath: micSidecarBackupPath(for: outputPath)),
    pendingURL: URL(fileURLWithPath: micSidecarPendingPath(for: outputPath))
  )
  guard let transactionLock = MicSidecarTransactionLock(transaction: transaction) else {
    log("mic sidecar merge: another helper owns the transaction lock")
    return false
  }
  defer { transactionLock.release() }

  /**
   * 没有既有事务时先检查 sidecar，避免空 sidecar 先写下 marker 后永远卡在 pending。
   * output 可读且 sidecar 没有可用音轨时，安全删除 sidecar 并保留主文件；output 也不可读
   * 时仍按安全失败处理，保留所有资产等待下一次恢复。
   */
  let hasExistingTransaction = FileManager.default.fileExists(atPath: transaction.backupURL.path)
    || FileManager.default.fileExists(atPath: transaction.pendingURL.path)
  if !hasExistingTransaction {
    guard isRegularFile(transaction.sidecarURL) else {
      log("mic sidecar merge: missing or invalid sidecar \(transaction.sidecarURL.lastPathComponent)")
      return false
    }
    let sidecarDuration = await readableAudioDuration(transaction.sidecarURL)
    if sidecarDuration <= .zero {
      guard await isEmptyReadableAudio(transaction.sidecarURL) else {
        log("mic sidecar merge: non-empty sidecar is unreadable")
        return false
      }
      guard await isReadableOutput(transaction.outputURL) else {
        log("mic sidecar merge: empty sidecar and unreadable primary output")
        return false
      }
      removeMicSidecarFile(transaction.sidecarURL, context: "mic sidecar merge")
      return !FileManager.default.fileExists(atPath: transaction.sidecarURL.path)
    }
  }

  guard let prepared = await prepareMicSidecarTransaction(
    transaction,
    primaryInputVolume: primaryInputVolume,
    primaryTimelineSegments: primaryTimelineSegments
  ) else {
    return false
  }

  if case .committed = prepared.state {
    return await verifyCommittedMicSidecarTransaction(transaction, context: "mic sidecar recovery")
  }

  guard isRegularFile(transaction.sidecarURL) else {
    log("mic sidecar merge: missing or invalid sidecar \(transaction.sidecarURL.lastPathComponent)")
    return false
  }

  let sidecarDuration = await readableAudioDuration(transaction.sidecarURL)
  guard sidecarDuration > .zero else {
    log("mic sidecar merge: unusable sidecar \(transaction.sidecarURL.lastPathComponent)")
    return false
  }

  /**
   * 事务仍处于 pending 时才允许重新混音。mixTracks 自己负责临时文件和原子 rename；
   * 这里只在确认最终 output 可读后推进事务状态。
   */
  guard await mixTracks(
    inputPath: transaction.outputURL.path,
    extraInputPaths: [transaction.sidecarURL.path],
    primaryInputVolume: prepared.primaryInputVolume,
    primaryTimelineSegments: prepared.primaryTimelineSegments
  ) else {
    log("mic sidecar merge: mix failed for \(transaction.sidecarURL.lastPathComponent)")
    rollbackPendingMicSidecarTransaction(transaction)
    return false
  }

  guard await isReadableOutput(transaction.outputURL),
        await isCommittedAfterMix(transaction) else {
    log("mic sidecar merge: output was not atomically committed")
    rollbackPendingMicSidecarTransaction(transaction)
    return false
  }

  return await verifyCommittedMicSidecarTransaction(transaction, context: "mic sidecar merge")
}

/** 保留 CLI 入口名称；真正的混音逻辑与正常 stop 共用 mergeMicSidecar */
func recoverMicSidecar(sidecarPath: String, outputPath: String) async -> Bool {
  await mergeMicSidecar(sidecarPath: sidecarPath, outputPath: outputPath)
}

/**
 * Swift 只确认原子替换后的 output 在当前进程可解码，不销毁 sidecar / checkpoint / marker。
 *
 * AVFoundation 的同进程资产状态可能看到刚收尾的缓存结果；Electron main 会再启动
 * 独立 helper 做 PCM 解码校验。只有 renderer 已成功导入业务存储后，Node 才删除整组恢复资产。
 */
private func verifyCommittedMicSidecarTransaction(
  _ transaction: MicSidecarTransaction,
  context: String
) async -> Bool {
  guard await isReadableOutput(transaction.outputURL) else {
    log("\(context): committed output is unreadable")
    return false
  }

  log("\(context): committed \(transaction.outputURL.lastPathComponent); recovery assets retained until import")
  return true
}

func isReadableOutput(_ url: URL) async -> Bool {
  await hasDecodableAudioSamples(url)
}

/** 只接受 0B 或可解析且全部为零时长的 CAF，非零损坏文件必须保留 */
private func isEmptyReadableAudio(_ url: URL) async -> Bool {
  guard isRegularFile(url) else { return false }
  do {
    let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
    if (attributes[.size] as? NSNumber)?.uint64Value == 0 {
      return true
    }

    let tracks = try await AVURLAsset(url: url).loadTracks(withMediaType: .audio)
    guard !tracks.isEmpty else { return false }
    for track in tracks {
      let timeRange = try await track.load(.timeRange)
      guard timeRange.isValid,
            timeRange.duration.isNumeric,
            timeRange.duration >= .zero
      else { return false }
      if timeRange.duration > .zero { return false }
    }
    return true
  }
  catch {
    return false
  }
}
