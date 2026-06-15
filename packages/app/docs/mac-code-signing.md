# macOS 签名总览

本文档说明 Electron macOS 包的两条签名路径：本机假证书和正式 Apple 证书

| 场景 | 用途 | 能否分发给别人 | 文档 |
|---|---|---|---|
| 本机假证书 / 自签名 | 让 TCC 权限稳定，解决打包后辅助功能、Fn 监听等授权反复失效 | 否 | [mac-local-self-signing.md](./mac-local-self-signing.md) |
| 正式 Developer ID 证书 | 给 `.dmg` / `.zip` 直接分发，配合 Apple 公证通过 Gatekeeper | 是 | [mac-official-signing.md](./mac-official-signing.md) |

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

## 核心区别

| 项 | 本机假证书 | 正式 Developer ID |
|---|---|---|
| 签名来源 | 自己生成的本地 code signing 证书 | Apple Developer Program |
| TCC 授权稳定 | 是 | 是 |
| Gatekeeper 放行 | 否 | 是，需公证 |
| 适合 CI 发布 | 否 | 是 |
| 是否需要 Apple 账号 | 否 | 是 |
