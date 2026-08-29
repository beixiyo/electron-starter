# macOS 录音坑点

本文只记录仍对当前实现有帮助的 macOS/Core Audio 事实。历史 VPIO 路线已移除，不是当前配置

## 已处理（fixed）

### 不可信的成功返回

`engine.start()`、writer append 和底层 IOProc 返回成功，都不能证明有真实样本。必须等待首帧、统计 callback、关闭后读取真实时长，并对最终文件做独立解码校验

### 麦克风与实时 AAC writer 解耦

麦克风写线性 PCM sidecar，避免实时 AAC writer 的 moov/PTS/加轨限制。系统音轨和 mic 的时间线在混音前对齐，sidecar 可以独立恢复

### callback 不阻塞

采集 callback 不执行算法或磁盘操作；处理消费者使用私有有界串行队列。队列满时选择 raw fallback，而不是阻塞采集或提升有缺口的 clean

### 输出覆盖保护

输入、输出、metrics 和辅助文件使用解析后的路径和文件身份检查，防止 symlink/hardlink 别名把输入原地覆盖。混音先写临时文件，再原子安装

### 设备与路由变化

raw 引擎启动和首帧探测需要重试；默认输入设备变化或 mic 长时间无样本时重建采集路线。旧引擎的异步回调未退场前不能立即析构

## 当前开放项（open）

- Process Tap 私有聚合设备配方和 TCC 音频权限在不同 macOS 版本上仍需设备矩阵验证
- 虚拟声卡、蓝牙、USB 麦克风和设备切换的声道/采样率变化需要真实测试
- checkpoint 丢失中间分片时，系统音频时间洞的恢复精度仍需专门验收
- 长录音的磁盘、CPU、RSS、stop→stopped 延迟必须实测，不能从短素材推算

## 已移除的错误路线：VPIO

历史实现用 `micAec` 选择 VPIO。实际遇到过非预期 7/9 声道、host time 不单调、参考流混入聚合设备、ducking 改变系统音量、失败后设备未释放等问题。当前代码不再通过参数启用 VPIO；裸采集是必要的采集降级，不等于自带 AEC

## 调查顺序

出现静音、短文件、回声或不同步时，按顺序收集：helper build-id、权限状态、设备拓扑、首帧和 callback 计数、每轨实际帧数、writer/reader NSError、checkpoint/handoff 代际、最终文件可播性。不要只看“start 成功”或文件大小
