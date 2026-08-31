// 管理 tap 录音的 host time、暂停偏移、样本边界与系统音连续片段

import AVFoundation
import CoreMedia

/**
 * tap 会话的逻辑时间轴状态所有者
 *
 * 物理采集回调使用 helper 的 monotonic host time；该对象负责将其转换为去除暂停时段的
 * 录音时间，并记录系统音在 AAC 压紧空洞后仍需恢复的连续片段。sampleQueue 之外的访问
 * 通过内部锁保护，调用方不需要再持有 TapRecorder 的时间轴锁
 */
final class TapRecordingTimeline {
  private let lock = NSLock()
  private var paused = false
  private var recordingStartHostTime: CMTime?
  private var pauseOffset = CMTime.zero
  private var pauseStartHostTime: CMTime?
  private var minimumAcceptedMicHostTime: CMTime?
  private var minimumAcceptedTapHostTime: CMTime?
  private var systemSegments: [AudioTimelineSegment] = []

  func begin() {
    lock.lock()
    paused = false
    recordingStartHostTime = CMClockGetTime(CMClockGetHostTimeClock())
    pauseOffset = .zero
    pauseStartHostTime = nil
    minimumAcceptedMicHostTime = recordingStartHostTime
    minimumAcceptedTapHostTime = recordingStartHostTime
    systemSegments = []
    lock.unlock()
  }

  func pause() {
    lock.lock()
    guard !paused else {
      lock.unlock()
      return
    }
    paused = true
    pauseStartHostTime = CMClockGetTime(CMClockGetHostTimeClock())
    lock.unlock()
  }

  func resume() {
    lock.lock()
    guard paused else {
      lock.unlock()
      return
    }
    if let pauseStartHostTime {
      let pausedHostDuration = CMTimeSubtract(
        CMClockGetTime(CMClockGetHostTimeClock()),
        pauseStartHostTime
      )
      pauseOffset = CMTimeAdd(pauseOffset, pausedHostDuration)
    }
    self.pauseStartHostTime = nil
    paused = false
    lock.unlock()
  }

  var isPaused: Bool {
    lock.lock()
    defer { lock.unlock() }
    return paused
  }

  /** 当前 host time 对应的去暂停录音时间，供动态路由建立跨轨一致边界。 */
  func currentLogicalTime() -> CMTime? {
    lock.lock()
    defer { lock.unlock() }
    guard let recordingStartHostTime else { return nil }
    let now = pauseStartHostTime ?? CMClockGetTime(CMClockGetHostTimeClock())
    return CMTimeMaximum(
      .zero,
      CMTimeSubtract(CMTimeSubtract(now, recordingStartHostTime), pauseOffset)
    )
  }

  /** 标记从当前 host time 起允许写入麦克风样本 */
  func markMicAcceptanceBoundary() {
    lock.lock()
    minimumAcceptedMicHostTime = CMClockGetTime(CMClockGetHostTimeClock())
    lock.unlock()
  }

  /** 标记从当前 host time 起允许写入系统音样本 */
  func markTapAcceptanceBoundary() {
    lock.lock()
    minimumAcceptedTapHostTime = CMClockGetTime(CMClockGetHostTimeClock())
    lock.unlock()
  }

  func logicalMicTime(at hostTime: CMTime) -> CMTime? {
    lock.lock()
    defer { lock.unlock() }
    guard !paused,
          hostTime.isNumeric,
          let recordingStartHostTime,
          let minimumAcceptedMicHostTime,
          hostTime >= minimumAcceptedMicHostTime
    else { return nil }

    return CMTimeMaximum(
      .zero,
      CMTimeSubtract(CMTimeSubtract(hostTime, recordingStartHostTime), pauseOffset)
    )
  }

  func retimeSystemSample(_ sampleBuffer: CMSampleBuffer) -> CMSampleBuffer? {
    let logicalTime: CMTime? = lock.withLock {
      let sourceTime = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
      guard !paused,
            sourceTime.isNumeric,
            let recordingStartHostTime,
            let minimumAcceptedTapHostTime,
            sourceTime >= minimumAcceptedTapHostTime
      else { return nil }

      return CMTimeMaximum(
        .zero,
        CMTimeSubtract(CMTimeSubtract(sourceTime, recordingStartHostTime), pauseOffset)
      )
    }
    guard let logicalTime else { return nil }

    var timing = CMSampleTimingInfo()
    guard CMSampleBufferGetSampleTimingInfo(sampleBuffer, at: 0, timingInfoOut: &timing) == noErr else {
      return nil
    }
    timing.presentationTimeStamp = logicalTime
    timing.decodeTimeStamp = .invalid

    var retimed: CMSampleBuffer?
    let status = CMSampleBufferCreateCopyWithNewTiming(
      allocator: kCFAllocatorDefault,
      sampleBuffer: sampleBuffer,
      sampleTimingEntryCount: 1,
      sampleTimingArray: &timing,
      sampleBufferOut: &retimed
    )
    guard status == noErr else { return nil }
    return retimed
  }

  func recordSystemSample(_ sampleBuffer: CMSampleBuffer) {
    let start = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
    let duration = CMSampleBufferGetDuration(sampleBuffer)
    guard start.isNumeric, start >= .zero, duration.isNumeric, duration > .zero else { return }

    lock.lock()
    defer { lock.unlock() }

    if let lastIndex = systemSegments.indices.last {
      var last = systemSegments[lastIndex]
      let expectedStart = CMTimeAdd(last.start, last.duration)
      let tolerance = CMTimeMaximum(
        CMTime(seconds: 0.05, preferredTimescale: 48_000),
        CMTimeMultiply(duration, multiplier: 2)
      )
      if start >= CMTimeSubtract(expectedStart, tolerance),
         start <= CMTimeAdd(expectedStart, tolerance) {
        last.duration = CMTimeAdd(last.duration, duration)
        systemSegments[lastIndex] = last
        return
      }
    }

    systemSegments.append(AudioTimelineSegment(start: start, duration: duration))
  }

  func snapshotSystemSegments() -> [AudioTimelineSegment] {
    lock.lock()
    defer { lock.unlock() }
    return systemSegments
  }

  func reset() {
    lock.lock()
    paused = false
    recordingStartHostTime = nil
    pauseOffset = .zero
    pauseStartHostTime = nil
    minimumAcceptedMicHostTime = nil
    minimumAcceptedTapHostTime = nil
    systemSegments = []
    lock.unlock()
  }
}

/** 系统音在最终录音逻辑时间轴上的一个连续有效区间 */
struct AudioTimelineSegment {
  var start: CMTime
  var duration: CMTime
}
