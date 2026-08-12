# audio-recorder —— macOS 原生录音 helper

Electron Starter 的原生录音子进程（Swift）。Electron 主进程通过管道驱动它采集音频，自己不碰 Core Audio

本文只讲**用法与架构**：怎么驱动它、协议长什么样、每个文件干什么、有哪些边界情况
Swift / macOS 的坑与规避见 [`MACOS-PITFALLS.md`](./MACOS-PITFALLS.md)

---

## 1. 它是什么 / 整体架构

Core Audio 的音频回调跑在**实时线程**（不能阻塞、不能进 JS），所以采集必须放在一个独立的 Swift 子进程里，Electron 只隔着管道发命令、收事件。这就是 sidecar 模型：

```
Electron 主进程 (Node / TS)
    │   stdin  ← JSON 命令 (start / stop / pause / resume / update)
    │   stdout → JSON 事件 (recording / paused / mixing / stopped / error)
    ▼
audio-recorder (Swift 子进程)
    ├─ tap 引擎（手动录音，macOS 14.2+）  process tap 系统音 + PCM 麦克风 sidecar，可热挂/卸
    └─ SCK 引擎（会议录音）              ScreenCaptureKit 全系统音频
        底层：Core Audio (Process Tap / 聚合设备 / IOProc) + AVFoundation
```

TS 侧的封装在 `packages/app/main/audio-recorder/`（`startRecording` / `onRecorderEvent` 等），业务收尾在 `packages/app/main/native-recording/`。本目录只负责 Swift 这一半

---

## 2. 怎么驱动它（TS ↔ Swift 协议）

### 2.1 常驻录音模式（默认，无 CLI 参数）

无参数启动即进入常驻模式：后台线程逐行读 stdin 的 JSON 命令，主循环把事件写到 stdout

**命令（stdin，一行一条 JSON）**

| 命令 | 字段 | 说明 |
| --- | --- | --- |
| `start` | `outputPath` `engine` `tapEnabled` `pids` `excludePids` `mic` `micAec` | `engine` 省略 = SCK 会议引擎；`engine:"tap"` = 手动 tap 引擎 |
| `update` | `tapEnabled` `micEnabled` `pids` `excludePids` | **仅 tap 引擎**：录音中热挂/卸麦克风与系统音轨、变更混入进程集合 |
| `pause` / `resume` | —— | 暂停 / 继续 |
| `stop` | —— | 停止并收尾（finishWriting + 离线混音），随后 emit `stopped` |

`start` 各字段（tap 引擎）：

- `tapEnabled`（默认 `true`）：是否随启动挂载系统音轨；`false` = 先纯麦克风开录，之后用 `update` 热挂系统音
- `mic`（默认 `true`）：是否采集麦克风
- `micAec`（默认 `true`）：麦克风是否走 VPIO（带回声消除）；`false` 则跳过 voice processing
- `pids` / `excludePids`：`pids` 非空 = 只混这些进程的音频；`pids` 为空 = 全系统混音、`excludePids` 排除（通常传自身进程族防自录）

**事件（stdout，一行一条 JSON）**

| 事件 | 字段 | 时机 |
| --- | --- | --- |
| `{"status":"recording","path"}` | 产物路径 | 采集真正开始 |
| `{"status":"paused","path"}` | | 已暂停 |
| `{"status":"mixing","path"}` | | 停止后进入离线混音 |
| `{"status":"stopped","path","duration","handoffId"}` | 路径 + 墙钟时长（秒）+ stop 代际 | 收尾完成，产物已落盘 |
| `{"status":"mic_degraded","detail"}` | 麦克风掉线诊断 | 麦克风重挂多次失败，系统音轨仍继续录制；这是非致命状态 |
| `{"status":"recycle_required","handoffId","detail"}` | stop 代际 | Tap terminal 的相邻前导消息：父进程只回收匹配该代际的 helper。若 terminal 丢失，2 秒 watchdog 或 child exit 会独立触发重建；若为 `finalize_queue_timeout`，writer 不再收尾，只保留 checkpoint / sidecar 交给崩溃恢复 |
| `{"error","path?","detail"}` | 错误码 + 可选录音路径 + 诊断详情 | 录音中/命令错误，不结算 stop handoff；watchdog error 带 path 供上层拒绝迟到事件 |
| `{"error","terminal":true,"path","handoffId","detail"}` | 错误码 + 录音路径 + stop 代际 + 诊断详情 | Tap/SCK 收尾失败 terminal；上层必须同时按 handoffId 与 path 代际消费 |

helper 发出的 `error` 码：

| 码 | 含义 |
| --- | --- |
| `already_recording` | 已在录音时又收到 `start`（同一子进程同一时刻只允许一路） |
| `tap_requires_macos_14_2` | tap 引擎在 < 14.2 系统上不可用 |
| `no_audio_samples` | 整场没写过任何样本（含 5s 首帧超时） |
| `no_audio_content` | 停止时只有系统音轨、麦克风已关且无内容 |
| `writer_failed` | 有样本但 writer 或最终混音收尾失败；恢复资产会保留（带诊断详情） |
| `storage_insufficient` | writer 确认磁盘空间不足（POSIX `ENOSPC`，detail 保留完整 NSError） |
| `audio_sample_timeout` | 录音中断流超 30s（**非致命**，供上层走挽救收尾保留已录音频） |

`mic_degraded` 刻意走 status 而不是 error：上层收到后只记录降级诊断，不能重置录音状态或删除仍在写入的系统音轨

> 注：TS 侧还会把某些情况映射成自己的码（如 `empty_recording`），那是主进程行为，不是 helper 发的

### 2.2 一次性 CLI 模式（权限探测 / 崩溃恢复）

带特定参数启动则跑完即退，不进常驻循环：

| 参数 | 作用 | 退出码 |
| --- | --- | --- |
| `--check-screen-capture` | 查屏幕录制权限（会议录音用） | 0 = 已授权 / 1 = 未授权 |
| `--prompt-screen-capture` | 申请屏幕录制权限 | 同上 |
| `--check-audio-capture` | 查系统音频权限（私有 SPI） | 0=granted 1=denied 2=not-determined/超时 3=SPI 不可用 4=系统 < 14.2 |
| `--prompt-audio-capture` | 申请系统音频权限（弹窗，300s 超时兜底） | 同上 |
| `--merge-checkpoints <segmentDir> <out>` | 崩溃后合并分片成产物 | 0 = 成功 / 1 = 失败 |
| `--recover-mic-sidecar <caf> <out>` | 崩溃后把麦克风 sidecar 混回产物 | 0 = 成功 / 1 = 失败 |
| `--validate-audio <path>` | 解码文件开头和结尾的有界 PCM 窗口，拒绝空轨与截断产物 | 0 = 可交付 / 1 = 不可解码或空轨 |

---

## 3. 两个引擎

| | tap 引擎（手动录音） | SCK 引擎（会议录音） |
| --- | --- | --- |
| 底层 | Core Audio Process Tap + 聚合设备 + 麦克风 sidecar | ScreenCaptureKit |
| 系统要求 | macOS 14.2+ | —— |
| 音源 | 麦克风 + 系统音（可只选其一） | 全系统音频 |
| 权限 | 系统音频（audio-capture）+ 麦克风 | 屏幕录制（screen） |
| 录音中热挂/卸 | ✅ 支持（`update`） | ❌ 无此语义 |
| 代码 | `TapRecorder.swift` 及 `Tap*` 组合对象 | `SCKRecorder.swift` |

同一子进程同一时刻只允许一路录音，由 `RecorderCoordinator` 持有 `activeEngine`（`.none` / `.sck` / `.tap`）并路由 `stop` / `pause` / `resume`

---

## 4. 模块地图

| 文件 | 职责 |
| --- | --- |
| `main.swift` | 入口装配与一次性 CLI 模式分发 |
| `Commands.swift` | stdin JSON 命令模型与解码 |
| `RecorderCoordinator.swift` | 两套录音引擎的唯一路由状态所有者 |
| `ProcessLifecycle.swift` | 命令串行链、SIGTERM / 父进程 / stdin EOF 收尾与进程级 watchdog |
| `TapRecorder.swift` | tap 会话编排：start/update/pause/resume/stop、mic 自愈、writer 与最终混音策略 |
| `TapProcessCapture.swift` | Process Tap、聚合设备、IOProc 与系统音样本归一 |
| `TapMicCapture.swift` | VPIO → raw AVAudioEngine → AVCaptureSession 三级麦克风物理采集 |
| `TapMicSidecarWriter.swift` | 麦克风 PCM 格式冻结、逻辑时间补静音、受限自动增益和 `.mic.caf` 写盘 |
| `TapRecordingTimeline.swift` | tap 会话 host time、暂停偏移、样本 cutoff 与系统音连续片段 |
| `MicrophoneSignalProcessor.swift` | Float32 PCM 人声电平跟踪、动态压缩、逐采样帧峰值保护与首个 2s 电平诊断 |
| `SCKRecorder.swift` | SCK 引擎：ScreenCaptureKit 全系统音频 |
| `Checkpoint.swift` | 分片 WAL：每 ~5s finalize 一个小 m4a，仅作崩溃兜底 |
| `AudioMixPlan.swift` | 预检输入资产，决定单轨直通或生成带时间轴的混音计划 |
| `AudioTrackMixer.swift` | 执行离线混音，并以同目录原子替换提交最终 M4A |
| `AudioPeakLimiter.swift` | 多轨求和后的 linked-channel 峰值保护；不影响单轨与 passthrough |
| `CheckpointRecovery.swift` | `--merge-checkpoints` 分片恢复 |
| `MicSidecarRecovery.swift` | 正常 stop / 崩溃恢复共用的 sidecar 混音事务；用 hard link + marker 避免重复混入，导入前保留原资产 |
| `AudioAssetInspector.swift` | 恢复与收尾共用的媒体可读性和时长检查 |
| `Permissions.swift` | 屏幕录制 TCC + 系统音频私有 SPI（`kTCCServiceAudioCapture`） |
| `Constants.swift` | build-id + 超时、重试和 checkpoint 生命周期常量 |
| `AudioQualityTuning.swift` | 系统音 AAC、混音增益与 tap 漂移补偿的可调质量策略 |
| `AudioSettings.swift` | AAC 编码参数 |
| `AudioWriterSetup.swift` | writer 音频输入能力校验与启动失败边界 |
| `Logging.swift` / `RecorderOutput.swift` | stderr 诊断工具 / stdout NDJSON 协议 |
| `AudioDeviceDiagnostics.swift` / `ErrorDiagnostics.swift` | 音频设备拓扑 / NSError 与磁盘空间诊断 |

### Starter 集成边界

- helper 已负责 checkpoint、麦克风 sidecar、优雅退出和恢复 CLI
- main 进程统一把 native 产物写到 `~/.electron-app/recordings/pending`，录音页挂载时扫描残留；已存在 sidecar 事务资产时先恢复该事务，否则按 checkpoint → sidecar 的顺序恢复
- Swift 收尾不删 sidecar / checkpoint / marker；main 必须用全新 helper 进程通过 `--validate-audio` 后才发布 `stopped` 或暴露恢复任务，renderer 成功导入 IndexedDB 后再按 `taskId` 一次性删除全部恢复资产
- renderer 只通过 typed IPC 按 `taskId` 读取和删除恢复资产，不能传任意本地路径
- helper stderr 与 `mic_degraded` 会追加到 `~/.electron-app/logs/native-recorder.log`，不只依赖 DevTools

---

## 5. 进程生命周期与优雅退出

三条退出路径都**必须等收尾（停止接收新样本 + 排空设备生命周期队列与采样队列 + `finishWriting` + 混音）完成再 `exit`**，否则混音写到一半被杀，会在恢复目录留下 `_mix_` 临时件（无 `moov` 不可播）与未混音原件：

- **SIGTERM**（TS 侧 `NativeBridge.stop()` 发）→ `finalizeAndExit()`
- **父进程死亡**（每 3s 检测 `getppid() == 1`）→ `finalizeAndExit()`
- **stdin 关闭**（父进程退出）→ `finalizeAndExit()`

`finalizeAndExit` 经命令串行链排到在飞命令之后再停录，另有 **20s 硬退看门狗**：万一 `finishWriting` / 混音挂起，强制 `exit(0)`，避免僵尸进程占着音频设备不放

---

## 6. 崩溃恢复概览（架构层）

正常收尾的产物来自主 writer + 离线混音，**分片不参与**。分片只是断电/崩溃的兜底：

1. 录音中：主 writer 写完整长 m4a；`Checkpoint.swift` 并行每 ~5s finalize 一个自洽小 m4a 到 `<产物>.segments/`
2. 正常停止：主进程以当前 native session 的 `outputPath` 排除活跃任务，停止收尾完成后再暴露成品
3. 崩溃/断电：session 不再活跃后，上层拉起 helper 走 `--merge-checkpoints`（重建系统音）+ `--recover-mic-sidecar`（把 `.mic.caf` 混回）

> 分片相关有一个已知的时长语义坑（崩溃恢复合并会静默偏短）见 `MACOS-PITFALLS.md`

---

## 7. 边界情况

- **单路录音**：正在录时再发 `start` → `already_recording`，不会打断当前录音
- **引擎能力差异**：`update`（热挂/卸、改进程集合）只对 tap 引擎有效；SCK 忽略
- **`micAec`**：`true` 优先走 VPIO；遇到无法解释的多声道布局或启动失败时降级裸采集，`false` 直接走裸采集
- **`pids` 语义**：非空 = 白名单只混这些进程；空 = 全系统混音，用 `excludePids` 排除自身进程族防自录
- **系统版本门**：tap 引擎 `< macOS 14.2` 直接 `tap_requires_macos_14_2`；audio-capture 权限探测 `< 14.2` 退出码 4
- **`audio_sample_timeout` 非致命**：它不是"录音失败"，而是"中断了、但已录部分完好"，上层据此走保留式收尾
- **麦克风单轨掉线**：系统音仍有样本时不会误判整场中断；helper 会监听默认输入设备并重建 mic 引擎，连续失败才发一次 `mic_degraded`
- **两轨时间轴**：系统样本与 mic sidecar 都归一到同一录音逻辑时间；AAC 主文件会压紧 PTS 空洞，因此正常收尾时由 `AudioTrackMixer` 按系统有效片段恢复热挂/卸期间的逻辑位置；mic 热挂/掉线缺口超过 100ms 且大于一个回调 buffer 时分块补静音，暂停时长从两轨统一扣除
- **混音响度**：正常收尾时，只有系统音与确认含有效信号的麦克风 sidecar 同时存在，才使用 `AudioQualityTuning.swift` 的系统轨增益；当前默认 1.0，多轨叠加峰值由 limiter 保护。整场未检测到有效 mic 时丢弃静音/底噪 sidecar，纯系统音继续直通，不二次编码也不进 limiter；纯 mic 作为唯一音源时仍保留。崩溃恢复时因无法可信重建该信号快照，优先保留系统主轨原增益
- **Tap 麦克风处理**：Voice Processing 明确开启 AEC / NS / AGC，仅接受声道语义可明确处理的 mono/stereo；遇到 Apple 未公开布局的多声道输出时回退 raw 采集，不猜测声道。SCK mic 由 ScreenCaptureKit 直接交付，不冒充具备同一套 Voice Processing 语义
- **Tap 麦克风后处理**：采集路径会随每个 PCM buffer 传递真实处理模式。Voice Processing 已包含 AEC / NS / AGC，因此自研层最多只补偿 +6 dB；raw AVAudioEngine / AVCaptureSession 最多补偿 +12 dB。两种模式都用平滑 downward expander 将停顿期低电平底噪最多衰减 18 dB，再用软膝压缩和逐采样帧 -1 dBFS 峰值保护控制瞬时峰值。扩展器不是频谱降噪，无法从说话声中分离同频持续噪声；raw 路径也不冒充具备 AEC / NS

---

## 8. 构建

- helper 二进制**不入 git**，产物在 `resources/native/mac/audio-recorder`
- `build:mac` 前须先 `build:native:mac`（`build-mac.sh` 支持目录源码编译整个 `audio-recorder/`）
- 启动时会打 build-id banner：`audio-recorder build <BUILD_ID>`。同一应用版本可能对应 dev / unpack / signed / 自动更新 / 手替多种 helper，用 `strings <helper> | rg <BUILD_ID>` 核验实际跑的是哪一版

---

## 9. 音质 A/B 调参

系统音频质量参数集中在 `AudioQualityTuning.swift`，修改后必须重新执行 `pnpm build:native:mac`。建议每轮只调整一个参数，并用同一音源、同一播放器音量比较：

- `SYSTEM_AUDIO_AAC_BIT_RATE`：默认 320 kbps，优先降低浏览器音乐再编码损失；44.1 / 48 kHz 可测试 192 / 256 / 320 kbps，低采样率会自动降至 Apple AAC 编码器允许的上限
- `MIC_AUDIO_AAC_BIT_RATE`：SCK 单声道 mic 默认 128 kbps，可 A/B 96 kbps 节省体积；tap mic 是无损 PCM sidecar，不受它影响
- `SYSTEM_AUDIO_VOLUME_WITHOUT_MIC`：纯系统音默认 1.0，可测试 1.05 / 1.1；非 1.0 会失去单轨直通并增加一次 AAC 编码，超过 1.0 时会进入限幅器
- `SYSTEM_AUDIO_AAC_ENCODER_QUALITY`：默认 `.max`；固定码率下的实际收益以成品 A/B 为准
- `SYSTEM_AUDIO_VOLUME_WITH_MIC`：系统音与有效 mic 同时存在时的系统轨增益；默认 1.0，不再固定衰减系统音，叠加峰值由 limiter 处理。若产品更强调人声突出，可 A/B 0.85 或 0.75。Tap 依据 sidecar 信号检测，SCK 依据 writer 的 system=2ch / mic=1ch 格式契约，两者都不会把 mic 一起衰减
- `AUDIO_LIMITER_CEILING` / `AUDIO_LIMITER_RELEASE_SECONDS`：只影响多轨离线混音；默认 0.95 / 80 ms，分别控制峰值余量与衰减恢复速度
- `TAP_DRIFT_COMPENSATION_QUALITY`：默认最高质量；降低可减少部分重采样 CPU，但可能增加长录音漂移伪影

多轨 render 会在 AAC 编码前做 linked-channel sample-peak 限幅；编码后仍可能出现少量 inter-sample / codec overshoot，所以测试系统 + mic 时仍应同时检查爆音和响度，不能只看平均电平

纯系统单轨且不需要恢复时间轴空洞时，成品直接保留首次 AAC，不再为“统一单轨”解码并二次编码。静音/底噪 mic sidecar 不会破坏这条直通路径；真实带麦克风、SCK 双轨或 tap 热挂空洞的录音仍必须经过离线混音。混音总线使用所有有效输入中的最高采样率（最高 48 kHz），不让低采样率系统轨拖低 mic

checkpoint 崩溃恢复的最后拼接使用 `AVAssetExportPresetAppleM4A`；它会保留可播 AAC 产物，但码率由 Apple exporter 自适应，不受上述系统音目标码率严格控制
