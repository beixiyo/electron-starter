# 录音概念词典

本文面向不熟悉音频工程的读者。这里的“音频”不是一个文件，而是几条具有不同来源、时间线和用途的采样流

## 两个主要来源

- **mic（麦克风）**：本机输入设备采集到的声音，可能包含本地说话声，也可能包含本机扬声器传回来的远端声音
- **system（系统音频）**：应用从 macOS 音频系统捕获的输出。会议场景通常只选择会议应用 PID，而不是全系统

## 处理过程中的角色

- **capture**：某个处理器当前正在处理的输入流。对正向 AEC 来说，通常是 mic
- **render / reference**：提供给回声消除器的参考流。它描述“扬声器或系统正在播放什么”，不是“麦克风听到了什么”
- **clean**：处理器输出的音频，例如去掉可预测回声后的麦克风轨
- **delivery**：最终交付给转写或用户播放的音轨。它可能是 clean，也可能是失败后的 raw 回退
- **raw**：未经 AEC 的原始麦克风 sidecar。它是最重要的恢复资产，任何实验处理失败都不能把它删除或覆盖

## AEC、AEC3 与 AES

- **AEC（Acoustic Echo Cancellation）** 是声学回声消除：估计扬声器声音如何通过空间进入麦克风，再从 mic 中减掉可预测部分
- **AEC3** 是 WebRTC Audio Processing Module 中的一套 AEC 实现，名字里的“3”是实现代际，不是三路音频
- **AES** 通常指 Advanced Encryption Standard（加密标准），不是这里的回声消除。本文所有“回声”均指 AEC，不是 AES

AEC 需要两路不同角色的信号：reference 是播放端，capture 是麦克风端。没有 reference 时，安全行为是给该 hop 喂数字静音；绝不能把 mic 自己当 reference，否则可能把本地说话声一起抵消

## VPIO 为什么不再用

**VPIO（Voice Processing I/O）** 是 Apple 提供的带语音处理的 I/O 单元，理论上包含 AEC、降噪和自动增益。实际 macOS 设备上，它可能暴露非预期的多声道布局、产生不可靠的 host time、改变输出设备状态，并在失败后留下设备争用

本项目选择更可控的路线：麦克风用裸 AVAudioEngine/AVCaptureSession 采集，AEC3 在自己的实时处理队列中运行。这样没有 VPIO 的隐式参考流和时间轴副作用；采集失败仍有裸采集降级

## macOS 捕获方式

- **Process Tap**：macOS 14.2+ 的进程级音频捕获方式。通过 PID 白名单选择目标应用，可排除 Electron Starter/app 自身及 helper 进程，避免把应用自己的声音录进去
- **SCK（ScreenCaptureKit）**：ScreenCaptureKit 音频捕获路径，依赖屏幕录制权限。Starter 保留它作为旧系统或不满足 Process Tap 条件时的系统音频路线
- **sidecar**：与主 M4A 分开的附属音频文件。麦克风 raw 以线性 PCM 写入 `.mic.caf`，便于热挂、恢复和失败回退，不依赖实时 AAC writer 的容器收尾

## 音频格式和文件

- **PCM**：未压缩采样数据。它占空间较大，但每个样本可直接读取，适合处理和恢复
- **CAF**：Apple 的音频容器，适合保存线性 PCM sidecar
- **AAC**：有损压缩编码。主系统音频常写入 M4A/AAC；编码后的文件不能作为 AEC 的精确 reference
- **M4A**：常见的 MPEG-4 音频容器，正式录音交付格式

## 时间、延迟和指标

- **时间线**：mic 和 system 不是必然同时到达。系统需要用录音逻辑时间标记每个 buffer；暂停时应冻结或扣除暂停区间
- **delay**：reference 与 capture 之间的相对延迟。AEC3 的 delay 是提示值，不应把一次离线测得的网络延迟永远写死在实时路径
- **dBFS**：相对于数字满幅的分贝。`0 dBFS` 是可表示上限，超过它就是数字削波
- **ERLE**：Echo Return Loss Enhancement，回声返回损耗增强，常用来描述回声被压低了多少 dB。它不能单独证明近端说话没有受损
- **dBFS、ERLE 和主观听感**必须结合看：系统音频增益、降噪、高通和编码都能改变电平，不能把所有变化归因于 AEC

## 实时处理与停止后处理

- **实时处理**：录音期间每个小块进入私有处理队列，由消费者送入 AEC3 并逐步写入临时 clean sidecar。停止时只需要排空、关闭并原子提升文件，不能再按整场录音做耗时算法
- **停止后处理**：停止后读取整份 raw 再处理。实现简单，但会把停止时间变成录音时长的函数，并可能撞 handoff watchdog；正式路径不采用它

## 失败相关概念

- **fallback**：算法不可用、reference 不完整、处理失败或队列丢帧时，交付 raw，而不是让正式录音失败
- **backpressure**：处理队列满了。正式采集 callback 不能阻塞等待；丢弃后必须标记本轮 clean 不可信，不能把带静音缺口的 clean 提升为正式交付
- **checkpoint**：录音过程中的可恢复分片。它保护系统音频和状态，helper 异常退出时由恢复链路合并
- **handoff**：helper 把 stop 后的终态交给 Electron 主进程。只有收到匹配会话和输出路径的终态，主进程才结算录音
