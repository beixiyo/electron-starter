// 统一校验 AVAssetWriter 的音频输入和启动结果，避免配置错误延迟成无样本故障

import AVFoundation
import CoreMedia
import Foundation

/**
 * 校验输出配置，创建音频 input 并加入 writer
 *
 * `AVAssetWriter.add` 不返回结果且要求调用方先检查能力；所有实时 writer 和离线混音
 * 共用该边界，避免调参后某一路静默进入 failed 状态
 */
func addAudioWriterInput(
  to writer: AVAssetWriter,
  outputSettings: [String: Any],
  sourceFormatHint: CMFormatDescription? = nil,
  expectsMediaDataInRealTime: Bool
) throws -> AVAssetWriterInput {
  guard writer.canApply(outputSettings: outputSettings, forMediaType: .audio) else {
    throw audioWriterSetupError("unsupported audio output settings", writer: writer)
  }

  let input = AVAssetWriterInput(
    mediaType: .audio,
    outputSettings: outputSettings,
    sourceFormatHint: sourceFormatHint
  )
  input.expectsMediaDataInRealTime = expectsMediaDataInRealTime
  guard writer.canAdd(input) else {
    throw audioWriterSetupError("cannot add audio writer input", writer: writer)
  }

  writer.add(input)
  return input
}

/** 启动 writer；失败时立即抛出包含 AVFoundation 原始错误的诊断 */
func startAudioWriter(_ writer: AVAssetWriter) throws {
  guard writer.startWriting() else {
    throw audioWriterSetupError("cannot start audio writer", writer: writer)
  }
}

private func audioWriterSetupError(_ message: String, writer: AVAssetWriter) -> NSError {
  var userInfo: [String: Any] = [NSLocalizedDescriptionKey: message]
  if let underlyingError = writer.error {
    userInfo[NSUnderlyingErrorKey] = underlyingError
  }
  return NSError(domain: "AudioWriterSetup", code: 1, userInfo: userInfo)
}
