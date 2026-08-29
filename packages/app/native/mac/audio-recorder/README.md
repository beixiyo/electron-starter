# audio-recorder macOS helper

这是 Electron Starter 的 Swift 原生录音子进程。它通过 NDJSON 与 Electron 主进程通信，负责 Core Audio/ScreenCaptureKit 采集、麦克风 sidecar、实时音频处理、混音和恢复资产；它不直接参与 renderer 或上传业务

完整文档按主题拆分在 [`packages/app/docs/audio-recording/`](../../../docs/audio-recording/README.md)：

- [概念词典](../../../docs/audio-recording/concepts.md)
- [系统结构](../../../docs/audio-recording/architecture.md)
- [配置与接入](../../../docs/audio-recording/configuration.md)
- [生命周期与恢复](../../../docs/audio-recording/lifecycle-and-recovery.md)
- [macOS 坑点](../../../docs/audio-recording/pitfalls.md)
- [文件职责地图](../../../docs/audio-recording/module-reference.md)
- [测试清单](../../../docs/audio-recording/testing.md)
- [原生依赖分发](../../../docs/audio-recording/distribution.md)

## 本目录只看什么

- `Package.swift`：SwiftPM target、系统框架和 RecorderAPM 依赖
- `main.swift` / `Commands.swift`：helper 进程入口与命令协议
- `TapRecorder.swift` / `TapProcessCapture.swift`：Process Tap 系统音频和录音生命周期
- `TapMicCapture.swift` / `TapMicSidecarWriter.swift`：裸麦克风采集、sidecar 和时间线
- `AudioProcessing/`：实时音频处理与 raw/clean promotion
- `AudioTrackMixer.swift`：停止后的轨道混音和原子输出
- `Checkpoint*.swift` / `MicSidecar*.swift`：崩溃恢复资产

构建入口是 `packages/app/scripts/native/build-mac.sh`；生成的 helper 和 XCFramework 不提交到 Git。修改 Swift 或原生依赖后，使用 `pnpm build:native:mac`，再按文档中的真实设备清单验证
