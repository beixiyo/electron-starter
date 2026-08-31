# 录音测试与证据

## 证据分层

- 静态检查只能证明调用链、默认值和文件配置
- Swift/TS 测试可以证明协议、状态机、回退、原子安装和边界条件
- 构建检查可以证明架构、minOS、依赖和许可证资源
- 真实 macOS 设备才能证明 TCC、Process Tap、设备路由、回声听感、长录音和 stop 延迟

## 设备矩阵

至少记录：Apple Silicon 与 Intel、macOS 版本（特别是 14.2 前后）、内置麦克风/扬声器、USB 麦克风、蓝牙耳机、外接显示器和虚拟声卡。每次测试记录输入/输出设备、采样率、声道数、系统音量和是否有耳机

## 会议场景

1. mic-only：只说本地话，确认没有 VPIO、没有 system tap，交付声音清晰
2. system-only：只播放目标会议 PID，确认没有录入其他应用
3. far-only：远端说话、本地静音，分别测试耳机和扬声器
4. near-only：本地说话、远端静音，确认 AEC 不删除近端
5. double-talk：远端和本地重叠说话，比较 off 与 AEC3，并记录残留回声、近端损伤和电平
6. 其他应用同时播放：确认 PID 白名单和 `excludePids` 生效
7. 会议检测触发：确认目标会议 PID、mic 和 system 同时存在；旧系统明确记录 processing=off

## 生命周期与压力

- 五次背靠背 start/stop，不应有设备争用、残留 partial 或 helper 代际错配
- pause/resume、会议中途热挂/卸 system、输入设备切换和蓝牙断开重连
- 真实五小时录音，记录平均/p95 CPU、RSS、磁盘增长、成品时长和 stop→stopped 时间
- 人为制造权限拒绝、system tap 无 callback、mic 掉线、处理队列背压和 helper crash，确认正式 raw 资产可交付

## 必须收集的日志和产物

- app/helper build-id、架构和 macOS 版本；
- start 参数摘要：engine、mic、tap、目标 PID 数量、exclude PID 数量、processing 类型（不要记录不必要的设备指纹）；
- 权限结果、设备格式、首帧时间、system/mic callback/appends/drops；
- AEC3 处理帧数、reference 缺失 hop、估计 delay、clean promotion 或 fallback 原因；
- stop/handoff generation、child exit、watchdog、checkpoint 和 recovery 结果；
- 最终 M4A、必要的 recovery 资产、helper 与 Electron 日志，以及关键文件的 SHA256

日志要能回答“哪个会话、哪个 helper、哪条音轨、哪个 PID、哪个阶段”，但不要把整段 PCM 或隐私内容写进日志
