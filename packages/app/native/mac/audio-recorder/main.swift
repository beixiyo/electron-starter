// 装配 native recorder 常驻进程，并分发权限与恢复类一次性 CLI

import Cocoa

// stdin JSON → {"action":"start","outputPath":"/tmp/rec.m4a"}                        // 会议录音:ScreenCaptureKit 全系统音频
//            → {"action":"start","outputPath":"...","engine":"tap","tapEnabled":false,
//               "pids":[123],"excludePids":[456],"mic":true,"audioProcessing":{"processor":"webrtcAec3"}} // 手动录音:tap 引擎(macOS 14.2+)
//            → {"action":"update","tapEnabled":true,"micEnabled":true,"pids":[123],"excludePids":[456]} // tap 录音中热挂/卸 mic 与系统音轨、变更混入进程集合
//            → {"action":"stop"}
// 进程级 CLI:--mono-output  最终成品写单声道(下游只接受单声道输入时使用);采集侧仍保持立体声
// stdout JSON ← {"status":"recording","path":"..."}
//             ← {"status":"stopped","path":"...","duration":125.3}
//             ← {"error":"..."}

signal(SIGPIPE, SIG_IGN)

if CommandLine.arguments.contains("--check-screen-capture") {
  if isScreenCaptureTrusted() {
    print("SCREEN_CAPTURE_TRUSTED")
    exit(0)
  }

  fputs("SCREEN_CAPTURE_NOT_TRUSTED\n", stderr)
  exit(1)
}

if CommandLine.arguments.contains("--prompt-screen-capture") {
  if requestScreenCaptureAccess() {
    print("SCREEN_CAPTURE_TRUSTED")
    exit(0)
  }

  fputs("SCREEN_CAPTURE_NOT_TRUSTED\n", stderr)
  exit(1)
}

// exit code 约定:0=granted 1=denied 2=not-determined/超时 3=SPI 不可用 4=系统版本不支持
if CommandLine.arguments.contains("--check-audio-capture") {
  guard #available(macOS 14.2, *) else {
    fputs("AUDIO_CAPTURE_UNSUPPORTED\n", stderr)
    exit(4)
  }
  guard let tcc = loadTCCFunctions() else {
    fputs("AUDIO_CAPTURE_SPI_UNAVAILABLE\n", stderr)
    exit(3)
  }

  switch tcc.preflight(kTCCServiceAudioCaptureName, nil) {
  case 0:
    print("AUDIO_CAPTURE_GRANTED")
    exit(0)
  case 1:
    fputs("AUDIO_CAPTURE_DENIED\n", stderr)
    exit(1)
  default:
    fputs("AUDIO_CAPTURE_NOT_DETERMINED\n", stderr)
    exit(2)
  }
}

if CommandLine.arguments.contains("--prompt-audio-capture") {
  guard #available(macOS 14.2, *) else {
    fputs("AUDIO_CAPTURE_UNSUPPORTED\n", stderr)
    exit(4)
  }
  guard let tcc = loadTCCFunctions() else {
    fputs("AUDIO_CAPTURE_SPI_UNAVAILABLE\n", stderr)
    exit(3)
  }

  tcc.request(kTCCServiceAudioCaptureName, nil) { granted in
    if granted {
      print("AUDIO_CAPTURE_GRANTED")
      exit(0)
    }
    fputs("AUDIO_CAPTURE_DENIED\n", stderr)
    exit(1)
  }

  /** 用户长时间不操作授权弹窗的兜底,避免调用方 execFile 永久挂起 */
  DispatchQueue.main.asyncAfter(deadline: .now() + 300) {
    fputs("AUDIO_CAPTURE_TIMEOUT\n", stderr)
    exit(2)
  }
  CFRunLoopRun()
}

if let mergeIndex = CommandLine.arguments.firstIndex(of: "--merge-checkpoints") {
  let args = CommandLine.arguments
  guard args.count > mergeIndex + 2 else {
    fputs("CHECKPOINT_MERGE_USAGE\n", stderr)
    exit(2)
  }

  Task {
    let ok = await mergeCheckpointSegments(
      segmentDir: args[mergeIndex + 1],
      outputPath: args[mergeIndex + 2]
    )
    exit(ok ? 0 : 1)
  }
  CFRunLoopRun()
}

if let recoverMicIndex = CommandLine.arguments.firstIndex(of: "--recover-mic-sidecar") {
  let args = CommandLine.arguments
  guard args.count > recoverMicIndex + 2 else {
    fputs("MIC_SIDECAR_RECOVERY_USAGE\n", stderr)
    exit(2)
  }

  Task {
    let ok = await recoverMicSidecar(
      sidecarPath: args[recoverMicIndex + 1],
      outputPath: args[recoverMicIndex + 2]
    )
    exit(ok ? 0 : 1)
  }
  CFRunLoopRun()
}

if let validateAudioIndex = CommandLine.arguments.firstIndex(of: "--validate-audio") {
  let args = CommandLine.arguments
  guard args.count > validateAudioIndex + 1 else {
    fputs("AUDIO_VALIDATION_USAGE\n", stderr)
    exit(2)
  }

  Task {
    let ok = await hasDecodableAudioSamples(URL(fileURLWithPath: args[validateAudioIndex + 1]))
    exit(ok ? 0 : 1)
  }
  CFRunLoopRun()
}

log("audio-recorder build \(AUDIO_RECORDER_BUILD_ID)")

let processLifecycle = ProcessLifecycle()
processLifecycle.start()

CFRunLoopRun()
