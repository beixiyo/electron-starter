# 生命周期与恢复

## 状态顺序

```text
idle → starting → recording ⇄ paused → stopping → stopped
             │                         │
             └─ start failure          └─ terminal/recovery
```

- `start`：主进程先建立会话身份和恢复资产，再发送 typed options。收到 helper 的真实 ready/recording 事件后才确认 starting 成功
- `update`：只更新 tap 的 mic/system/PID 选择；旧会话、旧 PID 或过期弹窗回调不能更新新会话
- `pause/resume`：由 recording state 统一转发，所有音轨使用同一逻辑时间规则
- `stop`：采集与处理队列排空、实时 M4A 关闭和校验；成功则原子安装，失败才执行 clean/raw sidecar 恢复混音，然后发送匹配 handoff 的 stopped

## callback 规则

Core Audio callback 不能执行磁盘 I/O、等待锁、运行 AEC3 或调用 Electron。callback 只做：

1. 复制样本到拥有生命周期的内存；
2. 记录采集时间和 buffer 统计；
3. 以非阻塞方式尝试进入有界队列；
4. 队列满时丢弃增强处理输入并记录事实

clean 文件由私有串行处理队列的消费者写入，不由 Core Audio callback 写入。这样磁盘慢、算法慢或文件关闭都不会把实时采集线程拖住

正式 raw 采集和系统音轨不应因为 clean 处理队列背压而停顿。发生丢帧后，本轮 clean 不可提升，必须交付 raw

## 回退矩阵

| 情况 | 正式交付 |
| --- | --- |
| `off` | 实时 raw/system 交付；实时交付失败则走原有 raw/mix 路径 |
| AEC3 不可用或启动失败 | raw mic，系统音轨按原路径保留 |
| 整轨 reference 缺失 | 不启用 AEC，交付 raw mic |
| 单个 hop reference 暂缺 | 向 AEC3 喂零，不喂 mic |
| AEC3 处理错误 | raw mic；保留错误诊断 |
| 处理队列背压丢帧 | raw mic；clean 不得 promotion |
| clean promotion/校验失败 | raw mic；清理未提升的本轮 clean 临时文件 |
| helper 崩溃或 handoff 超时 | recovery 使用 raw sidecar/checkpoint，不把迟到 clean 当成功 |

算法层的失败不能让已经写好的正式录音变成 terminal error。生产边界固定使用 raw fallback

## checkpoint、handoff 和 watchdog

- checkpoint 定期保存可恢复的系统音频分片；分片 finalize 必须在独立队列执行，不能阻塞 callback
- handoff 必须按会话代际和预期输出路径匹配，避免旧 helper 的迟到事件结算新录音
- watchdog 触发时不能只看退出码；SIGKILL、child exit、terminal error 和 stopped 是不同事实
- stop 的算法和混音工作必须在录音期间完成；正常收尾只关闭一个有界尾块。整场重算只作为异常 fallback，并可能超过主进程 handoff 预算
