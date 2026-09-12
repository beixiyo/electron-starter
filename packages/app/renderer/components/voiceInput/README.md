# 语音输入宿主

`useHeadlessVoiceCapture` 负责采集资源和转写任务。`useVoiceSession` 在应用层绑定主进程的会话身份，窗口、输入框和独立浮窗共用这条管线。

- 输入框用 `useEmbeddedVoiceSession` 登记唯一的 `host`，并用 `VoiceInputHost` 标记 DOM 焦点边界。
- 主窗口用 `VoiceImeWindowHost` 承接没有输入框宿主时的录音操作和结果。
- `VoiceImeApp` 承接应用外部输入时的独立浮窗。
- 采集器与转写器都由调用方注入；一轮开始后冻结两者。示例 `transcribeDemoAudio` 只返回明确标识的演示文本，不上传音频，也不提供识别服务。

停止会把文本连同原 `sessionId` 交给主进程。主进程按当前焦点选择一个投递目标；没有当前输入焦点时，依次考虑仍在场的冻结宿主、补投来源、显式登记的默认宿主，最后展示结果。焦点变化后不保证仍投回最初的输入框。

取消立即释放主进程会话槽位，音频在 renderer 内存保留 5 秒。撤销和失败重试复用该音频，调用补投通道，不重新打开麦克风或占用旧槽位。新一轮、路由失活、关闭和超时会清理旧音频；忽略 AbortSignal 的迟到转写也不能覆盖新一轮。

应用路由缓存使用 `@jl-org/react-router` 的 `useRouteKeepAliveEffect`。它与组件库 KeepAlive 的上下文不同，不能互换，否则缓存页隐藏后仍会被视为可用宿主。

`/voice-input-test` 展示两个独立输入宿主。Web 模式仅展示布局，桌面模式通过真实 IPC 启动；实体麦克风、辅助功能权限和系统焦点需要在未锁屏的桌面环境验证。
