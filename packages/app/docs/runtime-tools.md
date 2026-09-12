# 运行环境与诊断

开发构建开启运行环境调试入口。正式构建默认关闭；联调包可在构建环境中设置
`VITE_ENABLE_RUNTIME_TOOLS=true`。关闭时不读取旧的地址覆盖，避免调试配置影响正式请求。

页面顶部中央连续点击七次可打开环境面板，桌面端同时打开开发者工具。
`builtin` 使用构建配置，`local` 使用模板的本地 API / WebSocket 地址，`custom` 允许逐项覆盖。
留空字段回落构建配置。预设和端点键集中在 `renderer/config/runtimeEnv/constants.ts`。

保存后，本窗口立即使用新配置，已打开窗口通过 `storage` 事件同步。
HTTP 的下一次请求、下一次 OAuth 授权会重新取地址；已有连接由其所有者重建。
切换地址不会替调用方迁移账号，也不会修改第三方 OAuth 服务的回调白名单。
部署所需的远程 API / WebSocket 来源仍应加入构建配置 `VITE_CSP_CONNECT_SRC`。

Web 结构化日志保存在 `AppDiagnostics/logs` IndexedDB 中，初始化时清理超过 30 天的记录。
`collectWebDiagnosticLogs({ startAt, endAt })` 按时间范围生成 JSONL 附件；导出最多一万条、
10 MiB，超出时保留最新完整记录并返回 `truncated=true`。日志不会自动上传。
桌面环境仍使用主进程日志服务。

开发控制台可调用 `__appListErrorBoundaries()` 和
`__appThrowRenderError('main-window-root', 'test error')` 验证真实渲染异常与重试。
这些入口不会进入正式构建的运行路径。

开发构建右上角的 Mock 按钮展开请求模拟面板。默认没有 endpoint；通过
`initMock({ definitions })` 或 `setMockDefinitions(definitions)` 注入通用场景，
每个场景提供 MSW handlers。`getMockDelay('response')` / `getMockDelay('sequence')`
供 handler 读取当前延迟预设；框架不替 handler 改写响应时序。
全部场景关闭后停止 worker，并只注销本框架的脚本注册。`file://` 页面明确显示不支持。
Force offline 只模拟当前 renderer 的在线状态，不断开操作系统网络，也不控制主进程网络门禁。
配置单独保存在 `app:mock-debug-config`，随 storage 事件同步；正式构建不加载此框架。

更新状态仓的 `initUpdaterStore({ canPrompt, checkPolicy, autoPromptIntervalMs })` 接受宿主策略。
普通自动提示默认按当前会话 24 小时间隔节流；没有策略时不会自行判定强制更新。
策略命中强制更新后，关闭和 Escape 均不能退出弹窗，检查失败仍提供重试。
