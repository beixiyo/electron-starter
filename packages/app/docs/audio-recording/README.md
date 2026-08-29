# 录音系统文档

这里是 Electron Starter 录音系统的集中文档入口。文档分开描述概念、结构、参数、生命周期、macOS 限制、历史事故、测试和原生依赖；不要把历史行为当成当前契约

## 推荐阅读顺序

1. [概念词典](./concepts.md)：先理解 mic、system、reference、AEC3 等词
2. [系统结构](./architecture.md)：了解 Electron、Swift helper、音轨和恢复资产的关系
3. [配置与接入](./configuration.md)：查看 `StartRecordingOptions`、PID 过滤和默认行为
4. [生命周期与恢复](./lifecycle-and-recovery.md)：理解暂停、停止、回退和崩溃恢复
5. [macOS 坑点](./pitfalls.md)：修改 Core Audio 代码前必读
6. [测试清单](./testing.md)：按真实设备和会议场景验收
7. [依赖分发](./distribution.md)：了解 RecorderAPM 二进制如何生成和分发

补充材料：

- [文件职责地图](./module-reference.md)
- [早期事故与演进](./history.md)

## 当前边界

- 当前生产处理器只有 `off` 和 `webrtcAec3` 两种；没有 POC、LocalVQE、旧 schema 或环境变量配置入口
- 麦克风不走 VPIO。必要的裸采集降级路线仍保留，AEC3 失败时正式录音保留 raw 麦克风资产
- AEC3 在录音期间实时处理，采集 callback 只复制数据并入有界队列，不在 callback 内等待算法或磁盘
- macOS 14.2 及以上的会议录音使用指定会议进程的 Process Tap；较低系统使用既有 SCK 路径，且不启用 AEC3
- 文档描述设计契约和已知边界；真实设备矩阵、签名、公证和长录音性能仍必须按 [测试清单](./testing.md) 实测
