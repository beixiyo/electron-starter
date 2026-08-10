/** 两套录音引擎的唯一状态所有者，负责按 active engine 路由命令 */
final class RecorderCoordinator {
  private enum ActiveEngine {
    case none
    case sck
    case tap
  }

  private let sckRecorder = Recorder()
  private var tapRecorderStorage: AnyObject?
  private var activeEngine: ActiveEngine = .none

  func handle(_ command: RecorderCommand) async {
    switch command {
    case .start(let options):
      await start(options)
    case .update(let options):
      update(options)
    case .pause:
      pause()
    case .resume:
      resume()
    case .stop(let handoffId):
      await stop(handoffId: handoffId)
    }
  }

  func stop(handoffId: Int? = nil) async {
    if activeEngine == .tap, #available(macOS 14.2, *) {
      await tapRecorder().stop(handoffId: handoffId)
    }
    else {
      await sckRecorder.stop(handoffId: handoffId)
    }
    activeEngine = .none
  }

  private func start(_ options: RecorderCommand.StartOptions) async {
    guard activeEngine == .none else {
      emitError("already_recording")
      return
    }

    switch options.engine {
    case .sck:
      activeEngine = .sck
      let started = await sckRecorder.start(outputPath: options.outputPath)
      if !started {
        activeEngine = .none
      }

    case .tap(let tapOptions):
      guard #available(macOS 14.2, *) else {
        emitError("tap_requires_macos_14_2")
        return
      }

      activeEngine = .tap
      let started = await tapRecorder().start(
        outputPath: options.outputPath,
        pids: tapOptions.pids,
        excludePids: tapOptions.excludePids,
        withMic: tapOptions.mic,
        tapEnabled: tapOptions.tapEnabled,
        micAec: tapOptions.micAec
      )
      if !started {
        activeEngine = .none
      }
    }
  }

  private func update(_ options: RecorderCommand.UpdateOptions) {
    /** 仅 tap 引擎支持录音中热挂/卸音源与变更进程集合 */
    if activeEngine == .tap, #available(macOS 14.2, *) {
      tapRecorder().update(
        tapEnabled: options.tapEnabled,
        micEnabled: options.micEnabled,
        pids: options.pids,
        excludePids: options.excludePids
      )
    }
  }

  private func pause() {
    if activeEngine == .tap, #available(macOS 14.2, *) {
      tapRecorder().pause()
    }
    else {
      sckRecorder.pause()
    }
  }

  private func resume() {
    if activeEngine == .tap, #available(macOS 14.2, *) {
      tapRecorder().resume()
    }
    else {
      sckRecorder.resume()
    }
  }

  /** TapRecorder 带 macOS 14.2 availability，使用惰性存储避免不可标注 availability 的全局实例 */
  @available(macOS 14.2, *)
  private func tapRecorder() -> TapRecorder {
    if let existing = tapRecorderStorage as? TapRecorder {
      return existing
    }

    let created = TapRecorder()
    tapRecorderStorage = created
    return created
  }
}
