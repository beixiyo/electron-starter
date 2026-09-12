# HTTP 客户端工厂

`createHttpInstance(options)` 保持模板的响应拆包和用户资料形状。
`authMode` 默认 `session`；无需会话凭证的实例应显式设置为 `anonymous`。
`baseUrl` 可以是每次请求求值的函数，`timeout` 单位为毫秒，默认 `-1` 保留无超时行为。

应用请求头、诊断事件、业务错误和登录失效处理通过回调注入，不让共享包依赖应用路由或状态仓。
认证码默认保持 `4006`（刷新）与 `4100`（会话失效），可通过 `authCodes` 覆盖。
短暂网络故障不等同于会话失效，不应触发退出登录。

本包使用 `@jl-org/http@2.0.0`。普通 HTTP 调用兼容已有模板调用方；
从旧版接入 SSE 的项目需迁移到 2.0 的 `SSEStream` 异步迭代接口，
不能继续使用旧版 `{ cancel, promise }` 或 `fetchSSEAsIterator`。
当前模板没有旧 SSE 调用方。
