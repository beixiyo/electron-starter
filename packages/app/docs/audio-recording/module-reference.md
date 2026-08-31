# 文件职责地图

路径以 `packages/app` 为根。实现可能继续拆分文件，但职责边界应保持清楚

## Electron 主进程

| 路径 | 职责 |
| --- | --- |
| `main/audio-recorder/index.ts` | 启动和回收 helper、发送命令、解析 NDJSON、转发事件和校验最终产物 |
| `main/audio-recorder/protocol.ts` | TS ↔ Swift 的消息类型和解析边界 |
| `main/audio-recorder/handoff-coordinator.ts` | stop 代际、terminal 事件和 helper recycle |
| `main/native-recording/manual.ts` | 手动 mic/system 选择、PID 过滤和会话启动 |
| `main/native-recording/index.ts` | recording state 与 helper 状态同步、统一收尾/错误路由 |
| `main/native-recording/session.ts` | 当前 native 会话身份和输出路径 |
| `main/native-recording/start-recovery.ts` | starting 超时、半初始化 helper 回收和未成立资产清理 |
| `main/meeting-detection/` | 发现会议应用和保存会议 PID；不直接操作 Core Audio |
| `ipc/services/meeting-detection/` | renderer 与 main 的会议录音契约和服务 |

## Swift helper

| 路径/模块 | 职责 |
| --- | --- |
| `Commands.swift` | stdin 命令解码与参数校验 |
| `RecorderCoordinator.swift` | helper 内录音状态和引擎选择 |
| `TapRecorder.swift` | Process Tap 主轨、mic sidecar、动态路由、暂停/停止与实时交付编排 |
| `TapProcessCapture.swift` | PID 过滤、Process Tap/聚合设备和系统音频 callback |
| `TapMicCapture.swift` | 裸 mic 采集、首帧探测、设备变化和降级路线 |
| `TapMicSidecarWriter.swift` | mic PCM sidecar、逻辑时间线和格式归一 |
| `AudioProcessing/RealtimeEchoProcessor.swift` | realtime AEC3、reference 配对、路由 reset 与 clean mic |
| `AudioProcessing/RealtimeDeliveryMixer.swift` | system、clean/raw mic 的有界时间轴与录制期 AAC 成品 |
| `AudioTrackMixer.swift` | 系统音频与 mic 的最终混音、限幅和原子安装 |
| `MicSidecarTransaction.swift` / `MicSidecarRecovery.swift` | sidecar 事务和恢复 |
| `Checkpoint.swift` / `CheckpointRecovery.swift` | 系统音频 checkpoint 分片和合并 |
| `AudioAssetInspector.swift` | 文件可读性、真实时长和音频格式检查 |
| `Logging.swift` / `ErrorDiagnostics.swift` | stderr 诊断和 NSError 上下文 |
| `Permissions.swift` | 麦克风、屏幕录制和系统音频权限探测 |

## 构建与资源

| 路径 | 职责 |
| --- | --- |
| `native/mac/audio-recorder/Package.swift` | SwiftPM target、RecorderAPM binary target 和系统链接库 |
| `native/mac/audio-recorder/APMShim/` | 中性 C ABI 到 WebRTC APM 的窄适配层 |
| `native/mac/audio-recorder/Vendor/` | 跟踪 license；生成的 XCFramework 与 provenance 被忽略，由固定构建配方生成 |
| `scripts/native/build-mac.sh` | Swift helper、RecorderAPM 和许可证资源的构建/安装入口 |
| `resources/native/mac/` | electron-builder 消费的生成 helper 和许可证资源 |
| `electron-builder.yml` | helper 与许可证的打包清单 |
