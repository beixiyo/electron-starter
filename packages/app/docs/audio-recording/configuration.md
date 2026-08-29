# 配置与接入

## `StartRecordingOptions`

录音启动参数使用 typed options 对象。Electron 主进程只负责选择明确的产品策略；字段默认值、未知字段拒绝和数值范围校验在 native helper 的 `start` 命令边界统一完成。生产路径不读取环境变量，不根据 `dev`、`test` 或 `production` 改变音频处理策略

核心字段语义如下（以代码导出的类型为准）：

| 字段 | 作用 |
| --- | --- |
| `engine` | `tap` 表示 Process Tap 手动/会议进程录音；未满足条件时由调用方选择 SCK 路线 |
| `tapEnabled` | 是否挂载 system Process Tap；关闭时可以先录 mic，随后通过 update 热挂 |
| `mic` | 是否采集本机麦克风 |
| `pids` | system 音频白名单；非空时只捕获这些进程 |
| `excludePids` | system 音频排除列表，通常包含 Electron Starter/app 自身及 helper 进程族 |
| `audioProcessing` | typed 音频处理选项；省略或 `processor: 'off'` 表示不运行 AEC |

## `audioProcessing`

生产只接受当前版本的明确选项，不保留旧 schema、别名、兼容字段或隐藏环境变量。推荐形状：

```ts
type AudioProcessingOptions = {
  processor: 'off' | 'webrtcAec3'
  delayMode?: 'auto' | 'fixed' | 'hybrid'
  fixedDelayMs?: number
  noiseSuppression?: 'off' | 'low' | 'moderate' | 'high' | 'very-high'
  gainControl?: 'off' | 'agc1-adaptive-digital' | 'agc1-fixed' | 'agc2'
  highPass?: boolean
}
```

AEC3 默认值由代码在启动边界归一化：自动延迟估计、固定延迟回退、适度降噪、关闭额外增益控制、启用高通。实际数值和允许范围以 Swift/C ABI 校验为准；配置错误应在启动时明确失败，不静默解释为另一种配置

## 明确不支持的入口

- 没有 `micAec` 参数，也没有 VPIO opt-in。旧调用方需要迁移到 `audioProcessing`，不要再添加兼容 alias
- 没有 `FLOWTICA_AUDIO_PROCESSING_CONFIG` 环境变量
- 没有 `--mode test` 自动开启 AEC 或固定失败策略。所有 build mode 使用相同的默认值
- 没有把 AEC3 的内部帧长、线性输出或实验 metrics 暴露成顶层产品参数

## 手动录音参数

- 默认：`mic: true`、`tapEnabled: false`、`pids: []`，即只录本地麦克风
- 用户明确选择 system：`mic` 按选择、`tapEnabled: true`；`pids` 非空时只录这些进程，空数组表示录制所有软件，并通过 `excludePids` 排除 Electron Starter/app 自身及 helper 进程族
- `tapEnabled` 是是否录制 system 的唯一开关；`pids` 只负责在“所有软件”和“指定进程”之间选择范围，不兼任开关

## 会议录音参数

会议检测传入会议应用 PID，并保留 `excludePids`。在 macOS 14.2+，会议模式同时请求 mic 和该 PID 的 system 音频，并指定 `webrtcAec3`。旧系统只能走既有 SCK system 路线并关闭 processing；不能把旧系统伪装成具备 Process Tap/AEC3 能力

输出单声道不是 `StartRecordingOptions` 字段，而是 helper 启动参数/`ELECTRON_APP_MONO_OUTPUT` 构建运行边界。它和 `audioProcessing` 是两个独立契约，不要把构建运行参数混入每次录音的 typed start options
