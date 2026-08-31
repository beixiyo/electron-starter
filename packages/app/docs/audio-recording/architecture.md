# 录音系统结构

## 总体数据流

```text
renderer / meeting detection
        │ typed start options
        ▼
Electron main ── NDJSON stdin/stdout ── audio-recorder (Swift)
        │                                  │
        │                                  ├─ Process Tap：指定会议 PID 的 system
        │                                  ├─ raw mic：裸采集，写 .mic.caf
        │                                  ├─ realtime AEC3：mic + system reference
        │                                  └─ realtime delivery：system + clean/raw mic → temporary M4A
        ▼
checkpoint / handoff / recovery
        │
        ├─ realtime M4A 原子安装（成功且无丢块）
        └─ AudioTrackMixer fallback：system + clean/raw sidecar → final M4A
```

系统音频和麦克风的输入角色必须明确：正向路径中 `system` 是 AEC reference，`mic` 是 capture；不能把两者交换，也不能在 reference 缺失时用 mic 代替

## 两条启动语义

### 手动录音

手动入口由 renderer 的音源选择决定：默认是 mic-only。用户明确开启系统音频后，空 PID 列表表示所有软件，非空列表表示只录指定进程。录音中可以通过 update 热挂或卸载系统音频；麦克风 sidecar 仍保持自己的逻辑时间线

### 会议检测录音

会议检测找到目标应用后，将会议应用 PID 和排除列表传给 native recording。macOS 14.2+ 使用 Process Tap 捕获该会议进程，同时采集本机麦克风并启用 `webrtcAec3`；较低系统使用 SCK 系统音频路径，processing 为 `off`。两条路径都由同一个 Swift helper、handoff 和 recovery 状态机收尾

会议 PID 是“只录目标应用”的边界，不等于录制所有系统声音。`excludePids` 用来排除 Electron Starter/app 自身及相关 helper

## 实时 AEC3 数据流

1. Core Audio callback 只复制 PCM、记录逻辑时间并尝试进入有界队列，不写 clean 文件
2. 私有串行处理队列按时间线配对 mic 和 reference
3. reference 缺失的单个 hop 喂零；队列背压或算法错误不阻塞采集
4. AEC3 按固定处理块运行，clean mic、raw fallback mic 与 system 按同一逻辑时间进入有界实时混音器
5. 混音器在录制期间直接编码同目录临时 M4A；路由切换只冲刷已经到达的 PCM，随后重置相应轨道与 AEC 状态
6. stop 最多补一个 100 ms 尾块，解码校验后原子安装；任何不可信条件都保留 raw `.mic.caf` 并回退旧混音路径

## 收尾与恢复

停止时，Swift 先排空采集与处理队列，再关闭实时 M4A、主 writer、sidecar 和 checkpoint。实时 M4A 可解码且没有输入丢块时原子替换正式产物；否则复用主 writer、raw sidecar 与 checkpoint 走原有恢复混音。helper 崩溃残留的 `_realtime_*.m4a` 不进入恢复列表，非活跃会话扫描时会被删除

Electron 侧由 `NativeBridge` 负责进程通信，`RecorderHandoffCoordinator` 负责 terminal 代际，`native-recording` 负责按来源路由成功、失败、取消和恢复。helper 崩溃不是成功：必须等待 child exit 或匹配的 terminal handoff 事件

## 分层职责

| 层 | 负责 | 不负责 |
| --- | --- | --- |
| renderer / IPC | 用户选择、会议目标、typed options | 直接操作 Core Audio |
| main audio-recorder | helper 生命周期、协议解析、handoff | 处理 PCM 算法 |
| main native-recording | 手动/会议会话、状态机、恢复资产 | 伪造音频数据 |
| Swift capture | Process Tap、裸 mic、SCK、时间线 | JS 状态与上传 |
| Swift processing | AEC3、队列、clean/raw promotion | 修改正式业务状态 |
| mixer / recovery | 原子混音、checkpoint 合并、可播性校验 | 决定是否启用算法 |
