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
    ├─ tap 引擎（手动录音，macOS 14.2+）  麦克风 + 系统音混音，可热挂/卸
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
| `writer_failed` | 有样本但 `AVAssetWriter` 收尾失败（带 `NSError domain#code`） |
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

---

## 3. 两个引擎

| | tap 引擎（手动录音） | SCK 引擎（会议录音） |
| --- | --- | --- |
| 底层 | Core Audio Process Tap + 聚合设备 + 麦克风 sidecar | ScreenCaptureKit |
| 系统要求 | macOS 14.2+ | —— |
| 音源 | 麦克风 + 系统音（可只选其一） | 全系统音频 |
| 权限 | 系统音频（audio-capture）+ 麦克风 | 屏幕录制（screen） |
| 录音中热挂/卸 | ✅ 支持（`update`） | ❌ 无此语义 |
| 代码 | `TapRecorder.swift` | `SCKRecorder.swift` |

同一子进程同一时刻只允许一路录音，由 `Commands.swift` 的 `activeEngine`（`.none` / `.sck` / `.tap`）路由 `stop` / `pause` / `resume`

---

## 4. 模块地图

| 文件 | 职责 |
| --- | --- |
| `main.swift` | 入口：CLI 模式分发 + stdin/stdout 主循环 + 进程生命周期（SIGTERM / 父进程死亡 / 看门狗） |
| `Commands.swift` | 命令派发（串行链，杜绝交错）+ `activeEngine` 路由 + 优雅退出 `finalizeAndExit` |
| `TapRecorder.swift` | tap 引擎：麦克风三级降级采集、设备掉线自愈、系统音 process tap + 离线混音（最大的一块，~1700 行） |
| `SCKRecorder.swift` | SCK 引擎：ScreenCaptureKit 全系统音频 |
| `Checkpoint.swift` | 分片 WAL：每 ~5s finalize 一个小 m4a，仅作崩溃兜底 |
| `RecoveryMixing.swift` | 离线 `mixTracks` + `--merge-checkpoints` + `--recover-mic-sidecar` |
| `Permissions.swift` | 屏幕录制 TCC + 系统音频私有 SPI（`kTCCServiceAudioCapture`） |
| `Constants.swift` | build-id + 各超时/重试常量 + `FORCE_SYNTHETIC_MIC_TIMELINE` |
| `AudioSettings.swift` | AAC 编码参数 |
| `Logging.swift` | 诊断日志（stderr → `NativeBridge`）+ 开录设备拓扑快照 + `describeError` 展开 `NSError` |

### Starter 集成边界

- helper 已负责 checkpoint、麦克风 sidecar、优雅退出和恢复 CLI
- main 进程统一把 native 产物写到 `~/.electron-app/recordings/pending`，录音页挂载时扫描残留，并依次调用 `--merge-checkpoints` / `--recover-mic-sidecar`
- renderer 只通过 typed IPC 按 `taskId` 读取、导入 IndexedDB 和删除恢复资产，不能传任意本地路径
- helper stderr 与 `mic_degraded` 会追加到 `~/.electron-app/logs/native-recorder.log`，不只依赖 DevTools
- starter 不包含 Flowtica 的账号隔离、云端上传、转写任务与恢复弹窗等业务层；恢复成功后直接进入本地录音列表

---

## 5. 进程生命周期与优雅退出

三条退出路径都**必须等收尾（排空采样队列 + `finishWriting` + 混音）完成再 `exit`**，否则混音写到一半被杀，会在恢复目录留下 `_mix_` 临时件（无 `moov` 不可播）与未混音双轨原件：

- **SIGTERM**（TS 侧 `NativeBridge.stop()` 发）→ `finalizeAndExit()`
- **父进程死亡**（每 3s 检测 `getppid() == 1`）→ `finalizeAndExit()`
- **stdin 关闭**（父进程退出）→ `finalizeAndExit()`

`finalizeAndExit` 经命令串行链排到在飞命令之后再停录，另有 **20s 硬退看门狗**：万一 `finishWriting` / 混音挂起，强制 `exit(0)`，避免僵尸进程占着音频设备不放

---

## 6. 崩溃恢复概览（架构层）

正常收尾的产物来自主 writer + 离线混音，**分片不参与**。分片只是断电/崩溃的兜底：

1. 录音中：主 writer 写完整长 m4a；`Checkpoint.swift` 并行每 ~5s finalize 一个自洽小 m4a 到 `<产物>.segments/`，并在 `active.json` 写 `{pid, createdAt}`
2. 正常停止：删掉 `active.json`（干净收尾的信标）
3. 崩溃/断电：`active.json` 残留 → 上层据 pid + 时间戳判定需恢复 → 拉起 helper 走 `--merge-checkpoints`（重建系统音）+ `--recover-mic-sidecar`（把 `.mic.caf` 混回）

> 分片相关有一个已知的时长语义坑（崩溃恢复合并会静默偏短）见 `MACOS-PITFALLS.md`

---

## 7. 边界情况

- **单路录音**：正在录时再发 `start` → `already_recording`，不会打断当前录音
- **引擎能力差异**：`update`（热挂/卸、改进程集合）只对 tap 引擎有效；SCK 忽略
- **`micAec`**：`true` 走 VPIO（有回声消除但会引入多声道/时间轴问题，见 pitfalls）；`false` 走裸采集
- **`pids` 语义**：非空 = 白名单只混这些进程；空 = 全系统混音，用 `excludePids` 排除自身进程族防自录
- **系统版本门**：tap 引擎 `< macOS 14.2` 直接 `tap_requires_macos_14_2`；audio-capture 权限探测 `< 14.2` 退出码 4
- **`audio_sample_timeout` 非致命**：它不是"录音失败"，而是"中断了、但已录部分完好"，上层据此走保留式收尾
- **麦克风单轨掉线**：系统音仍有样本时不会误判整场中断；helper 会监听默认输入设备并重建 mic 引擎，连续失败才发一次 `mic_degraded`

---

## 8. 构建

- helper 二进制**不入 git**，产物在 `resources/native/mac/audio-recorder`
- `build:mac` 前须先 `build:native:mac`（`build-mac.sh` 支持目录源码编译整个 `audio-recorder/`）
- 启动时会打 build-id banner：`audio-recorder build <BUILD_ID> forceSyntheticMicTimeline=<bool>`。同一版本号可能对应 dev / unpack / signed / 自动更新 / 手替多种 helper，用 `strings <helper> | rg <BUILD_ID>` 核验实际跑的是哪一版
