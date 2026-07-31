import AVFoundation
import Cocoa
import CoreAudio
import CoreGraphics
import CoreMedia
import ScreenCaptureKit

/**
 * stop 收尾(排空采样队列 + finishWriting + mixTracks)进行中标记。
 *
 * 所有退出路径(SIGTERM / 父进程死亡 / stdin 关闭)必须等收尾完成再 exit,
 * 否则混音写到一半被杀:_mix_ 临时件(无 moov 不可播)与未混音双轨原件双双残留恢复目录。
 * 兼作 stop 重入护栏(stop 命令与 SIGTERM 并发时防双重 finishWriting)
 */
var isFinalizingRecording = false

func waitForRecordingFinalize(maxSeconds: Double = 15) async {
  let deadline = Date().addingTimeInterval(maxSeconds)
  while isFinalizingRecording && Date() < deadline {
    try? await Task.sleep(nanoseconds: 100_000_000)
  }
}

// MARK: - 命令派发与进程生命周期

let recorder = Recorder()

/**
 * 命令串行链:所有 stdin 命令与退出收尾逐条 await 前一条完成,杜绝交错。
 *
 * handleCommand 原先每条命令起独立 Task,并发时会互相踩:两个 start 交错会把
 * activeEngine 清零留下僵尸 tap;update 与 stop 交错会对同一批 CoreAudio 对象
 * 双重销毁(潜在崩溃)。commandChainQueue 仅护尾指针,命令本体仍异步串行执行。
 */
let commandChainQueue = DispatchQueue(label: "audio-recorder-command-chain")
var commandTail: Task<Void, Never> = Task {}

func enqueueCommand(_ work: @escaping () async -> Void) {
  commandChainQueue.sync {
    let previous = commandTail
    commandTail = Task {
      await previous.value
      await work()
    }
  }
}

/** TapRecorder 是 @available(macOS 14.2, *) 类,全局 let 不能带可用性标注,用惰性持有器绕开 */
var tapRecorderStorage: AnyObject?

@available(macOS 14.2, *)
func sharedTapRecorder() -> TapRecorder {
  if let existing = tapRecorderStorage as? TapRecorder {
    return existing
  }
  let created = TapRecorder()
  tapRecorderStorage = created
  return created
}

/** 两个引擎共用一个子进程,同一时刻只允许一路录音;stop/pause/resume 按此路由 */
enum ActiveEngine {
  case none
  case sck
  case tap
}

var activeEngine: ActiveEngine = .none

func stopActiveRecorder(handoffId: Int? = nil) async {
  if activeEngine == .tap, #available(macOS 14.2, *) {
    await sharedTapRecorder().stop(handoffId: handoffId)
  }
  else {
    await recorder.stop(handoffId: handoffId)
  }
  activeEngine = .none
}

func handleCommand(_ line: String) async {
  guard let data = line.data(using: .utf8),
        let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let action = json["action"] as? String
  else { return }

  switch action {
  case "start":
    guard activeEngine == .none else {
      emitError("already_recording")
      return
    }

    let outputPath = json["outputPath"] as? String ?? "/tmp/audio-recording-\(Int(Date().timeIntervalSince1970)).m4a"

    if json["engine"] as? String == "tap" {
      guard #available(macOS 14.2, *) else {
        emitError("tap_requires_macos_14_2")
        return
      }

      let pids = (json["pids"] as? [Any] ?? []).compactMap { ($0 as? NSNumber)?.int32Value }
      let excludePids = (json["excludePids"] as? [Any] ?? []).compactMap { ($0 as? NSNumber)?.int32Value }
      let mic = json["mic"] as? Bool ?? true
      let tapEnabled = json["tapEnabled"] as? Bool ?? true
      let micAec = json["micAec"] as? Bool ?? true

      activeEngine = .tap
      let started = await sharedTapRecorder().start(
        outputPath: outputPath,
        pids: pids,
        excludePids: excludePids,
        withMic: mic,
        tapEnabled: tapEnabled,
        micAec: micAec
      )
      if !started {
        activeEngine = .none
      }
    }
    else {
      activeEngine = .sck
      let started = await recorder.start(outputPath: outputPath)
      if !started {
        activeEngine = .none
      }
    }
  case "update":
    /** 仅 tap 引擎支持录音中热挂/卸音源(mic 与系统音轨)与变更进程集合;SCK 会议链路无此语义 */
    if activeEngine == .tap, #available(macOS 14.2, *) {
      let tapEnabled = json["tapEnabled"] as? Bool ?? true
      let micEnabled = json["micEnabled"] as? Bool ?? true
      let pids = (json["pids"] as? [Any] ?? []).compactMap { ($0 as? NSNumber)?.int32Value }
      let excludePids = (json["excludePids"] as? [Any] ?? []).compactMap { ($0 as? NSNumber)?.int32Value }
      sharedTapRecorder().update(tapEnabled: tapEnabled, micEnabled: micEnabled, pids: pids, excludePids: excludePids)
    }
  case "pause":
    if activeEngine == .tap, #available(macOS 14.2, *) {
      sharedTapRecorder().pause()
    }
    else {
      recorder.pause()
    }
  case "resume":
    if activeEngine == .tap, #available(macOS 14.2, *) {
      sharedTapRecorder().resume()
    }
    else {
      recorder.resume()
    }
  case "stop":
    let handoffId = (json["handoffId"] as? NSNumber)?.intValue
    await stopActiveRecorder(handoffId: handoffId)
  default:
    break
  }
}

var finalizeRequested = false

/** 退出收尾:经命令链串到在飞命令之后再停录并退出,避免与在飞 start/update 交错 */
func finalizeAndExit() {
  /**
   * 硬退出看门狗(独立于命令链):前驱命令的 finishWriting / mixTracks 万一挂起,
   * `await previous.value` 会永久阻塞,exit 永不到达→僵尸进程占着音频设备不退。
   * 首次触发即武装,20s 兜底强退(> waitForRecordingFinalize 的 15s,正常收尾先自然退出)
   */
  commandChainQueue.sync {
    guard !finalizeRequested else { return }
    finalizeRequested = true
    DispatchQueue.main.asyncAfter(deadline: .now() + 20) {
      log("finalize watchdog fired, forcing exit")
      exit(0)
    }
  }

  enqueueCommand {
    await stopActiveRecorder()
    await waitForRecordingFinalize()
    exit(0)
  }
}
