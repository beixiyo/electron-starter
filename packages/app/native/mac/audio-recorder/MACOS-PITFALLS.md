# macOS 录音的坑与规避

写给要改这个 Swift helper 的人。这里只讲 **macOS / Core Audio / AVFoundation 本身的坑**，以及现在代码是怎么绕过去的。用法看 [`README.md`](./README.md)

---

## 0. 一条核心教训（先记住这个）

> **macOS 音频 API 几乎所有失败都「返回成功，然后悄悄坏在下游」**

| 你调用 | 它返回 | 真实结果 |
| --- | --- | --- |
| `writerInput.append(buffer)` | `true` | 最终文件只有 0.06 秒 |
| `engine.start()` | 成功，`isRunning == true` | 一个回调都没有（僵尸引擎） |
| tap 的 IOProc | `noErr` | 样本全是零（−91dB 静音） |
| 权限探测 SPI 抛异常 | 折叠成 `unknown` | 其实没授权，录出一段纯静音 |

所以这里的**通用规避原则**只有一句：**不要信任任何一步的返回值，全部事后验尸 + 全链路埋点。** 下面每个坑的「怎么避」本质都是这句话的具体化

顺带记两个事实，解释为什么坑这么多：

- **抽象会漏**：高层 `AVFoundation` 说成功，底层现实（设备被占、VPIO 塞进来的参考流、tap 回调时序）把它打穿，而你收不到错误
- **组合爆炸**：每个坑都挂在 `{硬件 × 系统版本 × 输入/输出设备 × 权限 × 休眠 × 背靠背时序}` 的矩阵上，本机复现不了很正常，靠测试者日志 + 埋点定位

---

## 1. VPIO（带回声消除的麦克风）—— 单个最大祸源

`micAec:true` 时麦克风走 `VoiceProcessingIO`。它做回声消除，但副作用一堆

### 1.1 VPIO 把输入格式暴露成 7ch / 9ch
- **现象**：部分内建 MacBook 麦克风的 VPIO 路径，输入格式是 48000Hz / 7ch（Air）或 9ch（Pro），而不是预期的 1ch。writer 按 1ch 配，格式不兼容却**不报错**，只在最终文件里塌成 0.06 秒
- **真相**：VPIO 把内建扬声器输出当作回声消除的参考流，塞进了输入布局。苹果文档没写
- **怎么避**：采集格式 `channelCount > 2`（或 `sampleRate <= 0`）就**主动降级**为裸采集，不猜测 Apple 未公开的声道语义（`TapMicCapture.prepareVoiceProcessedMic`）

### 1.2 VPIO 的 `hostTime` 会冻结 / 不单调 → 麦克风时间轴塌缩
- **现象**：`micCb` 与墙钟严格线性（采集活着），但混音轨只剩 0.064s，媒体时长塌到 0.128s
- **真相**：VPIO 给 `installTap` 回调的 `when.hostTime` 在某些配置下 valid 但不前进
- **怎么避**：麦克风不进实时 AAC 时间轴，而是直接写独立 `.mic.caf` sidecar；线性 PCM 时长由实际帧数 / 采样率决定。热挂或掉线期间的缺口不用 VPIO 原始 PTS，而是按 helper 单调 host clock 的录音逻辑时间补静音，停止后再离线混入（`TapMicSidecarWriter`，见 §5）

### 1.3 VPIO 往聚合设备 IOProc 注入多声道参考流，排在 tap 流之前
- **现象**：取 `buffer[0]` 拿到的是 4ch 回声参考流，真正的 tap 音频被丢弃
- **怎么避**：IOProc 里**按 `mNumberChannels` 扫描 ABL 定位 tap 流**，跳过 VPIO 参考流，而不是无条件取第一个 buffer（`TapProcessCapture.handleBuffer`）

### 1.4 VPIO 默认 ducking 会压低系统音轨
- **现象**：录进来的系统音明显被压低
- **怎么避**：`enableAdvancedDucking:false, duckingLevel:.min` 关掉（`TapMicCapture.prepareVoiceProcessedMic`）

### 1.5 启用 VPIO 会重配置默认输出设备（顺序耦合）
- **怎么避**：**必须先起麦克风引擎、再读 tap 格式**，否则读到旧格式（`TapRecorder.start`）

### 1.6 VPIO 失败回退时不释放设备 → 下一步撞 `!dev`
- **怎么避**：每个 VPIO 失败的 `return false` 之前，显式 `engine.stop()` + `setVoiceProcessingEnabled(false)` 同步释放输入设备（`TapMicCapture.releaseVoiceProcessingMic`）。这是治 §2 设备争用的根

---

## 2. 设备争用 / 僵尸引擎

### 2.1 背靠背录音撞 `!dev`（`560227702`）
- **现象**：上一条录音刚释放设备，`engine.start()` 撞设备忙、瞬时失败
- **怎么避**：raw 引擎 start 失败**重试 3 次、间隔 0.35s**，只重试瞬时失败（`Constants.swift` 约 `:14-18`）

### 2.2 `engine.start()` 成功却零回调（僵尸引擎）—— 苹果无「首帧确认」API
- **现象**：`start()` 返回成功、`isRunning == true`，但 `installTap` 一个回调都没进，5s 后首帧看门狗才发现，整段丢失
- **真相**：苹果没有任何 API 告诉你「引擎起来后是否真有数据在流」
- **怎么避**：`start()` / `startRunning()` 成功后**再等 300ms 探首帧**（`TapMicCapture.waitForFirstSample`），零回调即判僵尸、拆引擎重试或降级

### 2.3 三级降级链
麦克风采集不是「起一个引擎」，而是一条降级链，任一层拿到真实回调就用，都写同一个 sidecar：

```
VPIO(AEC) → raw AVAudioEngine → AVCaptureSession
```
（`TapMicCapture.prepare`）

---

## 3. Process Tap（系统音频）—— Core Audio 底层

### 3.1 `tapCb=0`：IOProc 整场零回调，静默失败无 error
- **现象**：系统音一帧没录，但没有任何 `tap_failed` 之类错误。强相关于 system-audio 权限被关
- **怎么避（目前）**：靠「连续 1000 个静音 buffer」启发式告警 + 开录设备拓扑快照定位环境（虚拟声卡 / 聚合设备）。**这条尚未根治**，是独立待办

### 3.2 tap 启动瞬态竞态
- **现象**：`AudioHardwareCreateProcessTap` 后**立即** `readTapFormat` 在 Sequoia 上会竞态失败；`AudioDeviceStart` 返回 `noErr` 后也无首帧确认
- **怎么避**：读格式失败要 retry（外部实测 tap 建好后约 50ms 才可用）

### 3.3 聚合设备 ABL 按声道数选流会选错
- **现象**：双工虚拟声卡（如 NoMachine，2ch 输入 + 2ch 输出）自带一条 2ch 输入流且排在 tap 流之前，`first(where: mNumberChannels == …)` 恒选中它，真 tap 音频整体丢弃、系统轨 valid 但全零
- **怎么避**：不能只按声道数选，要按 stream 布局定位 tap 流的 index（开录 dump 完整 ABL 布局辅助定位）

### 3.4 私有聚合设备配方 + 严格拆除顺序
- **真相**：Process Tap 要一整套私有的聚合设备配方（main sub-device / TapList + drift compensation / `IsPrivate` / `TapAutoStart`），苹果没公开，是社区逆向 AudioCap 扒的；创建和拆除顺序错了会挂
- **怎么避**：保持 `TapProcessCapture.prepare/start/teardown` 的现有配方和拆除顺序，不要把 Core Audio 物理资源拆回会话编排层

### 3.5 `translatePID` 对「从未注册 Core Audio 的进程」失败
- **怎么避**：include / exclude 两种模式差异化兜底（`TapProcessCapture.makeDescription`）

---

## 4. 权限（TCC）—— 无公开 API

### 4.1 系统音频权限没有公开 API
- **真相**：`askForMediaAccess` 只管麦克风 / 摄像头。系统音频权限 `kTCCServiceAudioCapture` **没有公开查询 / 申请 API**
- **怎么避**：只能 `dlopen` 私有 `TCC.framework` SPI 去 preflight / request（`Permissions.swift` 约 `:29-45`，CLI 入口 `--check-audio-capture` / `--prompt-audio-capture`）

### 4.2 探测失败被折叠成 `unknown` → 放行 → 录出静音
- **现象**：SPI 不可用 / helper 被杀等异常被折叠成 `unknown`，而 `unknown` 一律放行；若实际 denied，tap 回调照常但样本恒零，链路不强失败
- **更稳的方向**：与其查 SPI，不如「试建一个测试 tap，成功才认为有权限」（Muesli 思路），当前尚未落地

### 4.3 屏幕录制（会议 / SCK）被拒但录音假装开始
- **怎么避**：SCK 录音**开录前**先查 `screen` 权限拦截；`getMediaAccessStatus('screen')` 从不返回 `not-determined`，别依赖它区分「未决」

---

## 5. AVFoundation writer / reader

### 5.1 实时 AAC `AVAssetWriter` 不可信
- **现象**：`append() == true` 但最终 m4a 只有 0.06s，或 `finishWriting` 报 `-11800` / `-11829` / Cannot Open
- **怎么避（根因绕行）**：麦克风**不走实时 AAC writer**，改写独立 `.mic.caf` 线性 PCM sidecar，停止后离线 `mixTracks` 混入（`TapMicSidecarWriter` + `AudioTrackMixer`）。主 m4a 即使 Cannot Open，只要 sidecar 可读仍能恢复

### 5.2 `AVAssetWriter` 开写后不能加轨
- **真相**：这是硬约束，不是 bug
- **怎么避**：Tap 主 writer 只写系统音轨，麦克风始终写独立 PCM sidecar，因此录音中可以热挂/卸 mic，无需对已启动的 writer 动态加轨。收尾时 `AudioTrackMixer` 只混入可读且非空的轨

### 5.3 默认输入设备变化与麦克风单轨掉线
- **现象**：默认输入设备变化 / 采样率变化 / exclusive access 被抢占时，Core Audio 会静默重协商 input chain，引擎悬空
- **为什么旧看门狗发现不了**：系统音轨仍持续出样时，整场 `audio_sample_timeout` 不会触发，表现为录音成功但后半段无人声
- **怎么避**：分别记录系统音与 mic 的最近样本时间；mic 连续 8s 无样本时整机 fresh rebuild，而不是 restart 旧实例
- **设备复联**：在 HAL 层监听默认输入设备变化，蓝牙断开后重新连接或切换输入设备时重新挂载 mic
- **退避边界**：连续重挂失败最多自动重试 3 次，之后停止周期空转并发一次非致命 `mic_degraded`；HAL 后续设备变化会清零退避重新尝试
- **并发边界**：看门狗、HAL listener 和命令链的重挂请求统一经过锁与串行命令队列，避免 stop/update/recovery 交错拆建同一个引擎

### 5.4 mixTracks 分不清 reader 正常 EOF 与中途解码失败
- **现象**：`copyNextSampleBuffer` 返 nil 既可能是正常结束、也可能是中途失败，直接 `markAsFinished` 会让截断产物覆盖完整原件
- **怎么避**：收尾**核对 `reader.status == .completed` 与 `writer.status`**，失败就中止、不覆盖（`AudioTrackMixer.mixTracks`）

### 5.5 热挂麦克风格式漂移
- **现象**：录音中关麦再开麦，新 buffer 格式与 sidecar 初始格式不同，直接 `AVAudioFile.write` 抛错致后续全丢、甚至崩溃
- **怎么避**：`TapMicSidecarWriter` 首次创建 sidecar 后冻结目标格式，后续写入前比对，不一致用缓存的 `AVAudioConverter` 转成 `processingFormat` 再写，转换失败丢当前帧不崩溃

### 5.6 热挂 / 掉线不能把 mic 时间轴拼短
- **现象**：开录 10s 后才开 mic，若 sidecar 只连续写收到的 PCM，人声会被错误混到录音开头；掉线重连也会让后续人声整体前移
- **怎么避**：`TapMicCapture` 在 callback 到达时读 helper 自己的单调 host clock，`TapRecordingTimeline` 换算为扣除 pause 的逻辑时间，`TapMicSidecarWriter` 对超过 100ms 且大于一个回调 buffer 的缺口分块写零。不再依赖可能冻结的 VPIO `when.hostTime`

### 5.7 热挂系统 tap 不能从成品 0 秒开始
- **现象**：先录 mic、数秒后才打开系统音时，若 writer 以首个 tap PTS 启动 session，系统音会在最终混音中被错误挪到开头
- **根因**：即使 writer 从 `.zero` 启动 session，实际 AAC/M4A 编码仍会把输入 PTS 空洞压成连续媒体，不能依赖 empty edit 自动保留热挂前静音
- **怎么避**：系统样本先归一到与 mic 相同的录音逻辑时间，同时记录每段连续有效区间；正常收尾时 `AudioTrackMixer` 将压紧后的系统媒体按区间放回逻辑位置。暂停前迟到样本由 host-time cutoff 丢弃
- **恢复限制**：checkpoint 没有持久化这份片段映射；崩溃恢复仍可能压缩系统音热卸/重挂空洞

---

## 6. 崩溃恢复 / checkpoint —— m4a 容器语义

### 6.1 `size > 0` 不代表可播（`moov` 陷阱）
- **现象**：断电 / SIGKILL 残留的主 m4a `size > 0`，但没有 `moov` box，不可播
- **怎么避**：恢复判据一律用 `loadTracks` 读**真实媒体时长**，而不是 `size > 0`（`AudioAssetInspector`）

### 6.2 merge 丢段时静默压缩时间轴 → 超长录音崩溃恢复会**偏短**
- **现象**：`--merge-checkpoints` 是按 cursor **首尾相接**拼接（`cursor += 段时长`），**不留空洞**。丢尾段固定丢 ≤5s；丢中间段则少 5s 且**后面的音频整体前移**，最终时长 = Σ 存活段，**只会偏短、永不偏长，且无任何降级标记**。若麦克风在录，sidecar 完整恢复会让总长接近真实，但系统音已被压缩 → **系统音与人声 desync**
- **影响**：正常收尾的超长录音时长是准的（这条只发生在崩溃恢复路径）
- **怎么避（待改）**：合并时应**按分片序号 × 间隔定位每段起点**（或分片头写入真实起始 host-time），丢段就**留静音空洞**而非首尾相接。目前尚未改

### 6.3 分片写入不能阻塞采集（已处理，别改坏）
- 昂贵的 `finishWriting`（刷 moov + fsync）跑在**独立 `finishQueue.async`**，不在采集的 `sampleQueue` 上；采集队列上 rotate 只做 O(1) 的 `markAsFinished` + 置 nil
- 若上一段还在 finalize，rotate **直接跳过**，当前段继续变长而非阻塞采集（`Checkpoint.swift` 约 `:188-198`）
- 改这块时务必保持「finalize 移出采集队列 + inFlight 跳过 rotate」这两道，否则慢盘会卡死采集、丢帧

---

## 7. 只在代码 / commit 里、容易踩的隐性事实

- **旧的 mic realtime AAC / PTS 重定时路径已删除**：Tap 的麦克风只进 `.mic.caf` sidecar，不要重新把 VPIO `hostTime` 当成可信的媒体时间轴
- **checkpoint 分片当前只装系统音轨**，麦克风崩溃恢复靠独立的 `--recover-mic-sidecar`。若日后让麦克风也进 checkpoint，会复活「分段边界裁样 / startSession 前丢样」这类潜在 bug
- **Process Tap 未授权时全链路 `noErr` 但样本恒零**，无法与真静音区分（§3.1 / §4.2）
- **build-id banner 打进二进制**：同版本号可能对应多种 helper，用 `strings <helper> | rg <BUILD_ID>` 核验实际跑的是哪版，别假设装的是最新的
- **`finalizeAndExit` 20s 硬看门狗以 `exit(0)` 退出**：收尾挂起被强杀时是**成功码**，父进程无法据退出码区分成败——排查挂起问题别只看 exit code

---

## 8. 一句话总结规避套路

1. **每步验尸**：`start` 后探首帧、`append` 后回读产物时长、`finishWriting` 后查 `writer.status`、恢复看真实时长而非 size
2. **三级降级**：VPIO → raw → AVCapture，任一层拿到真实回调就用
3. **旁路兜底**：麦克风走独立 sidecar，绕开最不可靠的实时 AAC writer 与 VPIO 计时
4. **全链路埋点**：tap/mic 回调计数、PTS、设备拓扑、`NSError domain#code` 全走 stderr——生产项目应由主进程持久化，不能只留在终端；本机复现不了时只能靠日志验尸
