# macOS 签名总览

本文档说明 Electron macOS 包的两条签名路径：本机假证书和正式 Apple 证书

权限测试、`tccutil` 重置和开发模式终端授权说明见 [permission-testing.md](./permission-testing.md)

| 场景 | 用途 | 能否分发给别人 | 文档 |
|---|---|---|---|
| 本机假证书 / 自签名 | 让 TCC 权限稳定，解决打包后辅助功能、Fn 监听等授权反复失效 | 否 | [mac-local-self-signing.md](./mac-local-self-signing.md) |
| 正式 Developer ID 证书 | 给 `.dmg` / `.zip` 直接分发，配合 Apple 公证通过 Gatekeeper | 是 | [mac-official-signing.md](./mac-official-signing.md) |

用到受管能力（`keychain-access-groups`、Associated Domains、App Groups 等）时，正式分发还需内嵌 provisioning profile，否则签名公证正常但启动被系统杀掉（`exit 137` / 无法打开），见 [mac-managed-capabilities.md](./mac-managed-capabilities.md)

Passkey（Touch ID）登录的代码侧实现见 [mac-passkey.md](./mac-passkey.md)，签名侧依赖上面那份

## 先选哪条

本机开发、调试权限问题，走假证书流程：

```bash
pnpm -F app sign:setup
pnpm -F app build:unpack:prod
```

准备发给用户安装，走正式证书流程：

```bash
pnpm -F app build:mac:prod
```

正式流程需要提前准备 `Developer ID Application` 证书和公证凭证。不要把 `.p12`、`.p8`、证书密码或 Apple ID 应用专用密码提交到仓库

如果正式打包时报 `The timestamp service is not available`，优先检查 macOS Wi-Fi DNS。公共 DNS 可能绕过公司网关的 fake-ip / 透明代理 DNS，导致 Apple timestamp 直连失败；具体排查见正式签名文档的网络章节

## 核心区别

| 项 | 本机假证书 | 正式 Developer ID |
|---|---|---|
| 签名来源 | 自己生成的本地 code signing 证书 | Apple Developer Program |
| TCC 授权稳定 | 是 | 是 |
| Gatekeeper 放行 | 否 | 是，需公证 |
| 适合 CI 发布 | 否 | 是 |
| 是否需要 Apple 账号 | 否 | 是 |
