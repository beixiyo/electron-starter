# macOS 正式签名与公证

本流程用于直接分发 Electron macOS 应用，例如 `.dmg` / `.zip`。它需要 Apple Developer Program 的 `Developer ID Application` 证书和 Apple 公证凭证

本机开发权限稳定问题请看 [mac-local-self-signing.md](./mac-local-self-signing.md)

## 占位符

| 占位符 | 含义 |
|---|---|
| `<developer-id-name>` | Developer ID 身份名，不含 `Developer ID Application:` 前缀，例如 `Example Company (ABCDE12345)` |
| `<team-id>` | Apple Developer Team ID，例如 `ABCDE12345` |
| `<app-name>` | `.app` 名称，通常等于 `productName` |
| `<app-id>` | Bundle ID，例如 `com.example.app` |

## 1. 创建 Developer ID Application 证书

在 macOS **钥匙串访问** 中生成 CSR：

1. 让 **钥匙串访问** 成为前台应用
2. 点屏幕顶部菜单栏 **钥匙串访问 → 证书助理 → 从证书颁发机构请求证书...**
3. 填 Apple ID 邮箱，CA 邮箱留空
4. 选择 **存储到磁盘**
5. 保存 `CertificateSigningRequest.certSigningRequest`

到 Apple Developer 创建证书：

1. 打开 `https://developer.apple.com/account/resources/certificates/list`
2. 进入 **Certificates, Identifiers & Profiles → Certificates → +**
3. 选择 **Developer ID Application**
4. 上传 CSR
5. 下载 `.cer`
6. 双击导入，钥匙串选择 **登录** / `login`

如果页面只看到 **Apple Development**、**iOS App Development**、**Mac Development**，不要选。它们不是直接分发证书。通常是当前账号不是 Account Holder，或团队不是付费 Apple Developer Program

验证证书：

```bash
security find-identity -v -p codesigning
```

预期看到：

```text
Developer ID Application: Example Company (ABCDE12345)
```

如果签名时报 `errSecInternalComponent`，给 `codesign` 授权访问登录钥匙串私钥：

```bash
read -s LOGIN_KEYCHAIN_PASSWORD
security set-key-partition-list \
  -S apple-tool:,apple:,codesign: \
  -s \
  -k "$LOGIN_KEYCHAIN_PASSWORD" \
  ~/Library/Keychains/login.keychain-db
unset LOGIN_KEYCHAIN_PASSWORD
```

## 2. 配置 electron-builder.yml

模板：

```yaml
appId: <app-id>
mac:
  identity: '<developer-id-name>'
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
  hardenedRuntime: true
  forceCodeSigning: true
  notarize: true
  binaries:
    - Contents/Resources/fn-listener
    - Contents/Resources/focus-check
    - Contents/Resources/audio-monitor
    - Contents/Resources/audio-recorder
```

说明：

| 配置 | 作用 |
|---|---|
| `identity` | 不要写 `Developer ID Application:` 前缀，electron-builder 会自动匹配证书类型 |
| `entitlements` | 主 app 签名权限 |
| `entitlementsInherit` | Helper / Framework 继承权限 |
| `hardenedRuntime` | 公证需要 hardened runtime |
| `forceCodeSigning` | 找不到签名身份时直接失败，避免产出未签名包 |
| `notarize` | 开启 electron-builder 内置公证 |
| `binaries` | 额外 Mach-O helper。没有额外原生二进制时可删除 |

## 3. 配置签名和公证凭证

本机钥匙串已有证书时，可只指定证书名：

```bash
export CSC_NAME='<developer-id-name>'
```

CI 或换机器打包时，导出 `.p12` 后使用：

```bash
export CSC_LINK="$HOME/Secrets/Developer_ID_Application.p12"
export CSC_KEY_PASSWORD='p12 密码'
export CSC_NAME='<developer-id-name>'
```

公证推荐使用 App Store Connect API Key：

```bash
export APPLE_API_KEY="$HOME/Secrets/AuthKey_XXXXXXXXXX.p8"
export APPLE_API_KEY_ID='XXXXXXXXXX'
export APPLE_API_ISSUER='00000000-0000-0000-0000-000000000000'
```

也可以用 Apple ID 应用专用密码：

```bash
export APPLE_ID='your-apple-id@example.com'
export APPLE_APP_SPECIFIC_PASSWORD='xxxx-xxxx-xxxx-xxxx'
export APPLE_TEAM_ID='<team-id>'
```

不要把 `.p12`、`.p8`、密码或 token 写进仓库

## 4. 打包

```bash
pnpm -F app build:mac:prod
```

electron-builder 会执行：

1. 签名 `.app`
2. 上传 Apple 公证
3. stapler 钉装公证票据
4. 生成 `.dmg` / `.zip`

## 5. 验证

```bash
codesign --verify --deep --strict --verbose=2 packages/app/dist/dist/mac*/<app-name>.app
codesign -dv --verbose=4 packages/app/dist/dist/mac*/<app-name>.app
spctl --assess --type execute --verbose=4 packages/app/dist/dist/mac*/<app-name>.app
xcrun stapler validate packages/app/dist/dist/mac*/<app-name>.app
```

预期：

```text
Authority=Developer ID Application: ...
TeamIdentifier=<team-id>
accepted
```

## 常见问题

| 问题 | 处理 |
|---|---|
| 看不到 `Developer ID Application` | 切换正确团队，或让 Account Holder 创建证书 |
| `No identity found` | 确认证书带私钥，`CSC_NAME` 不含 `Developer ID Application:` 前缀 |
| `errSecInternalComponent` | 执行 `security set-key-partition-list` 授权 codesign |
| 公证 401 | 检查 API Key / Issuer ID / Key ID，或 Apple ID 应用专用密码和 Team ID |
| 公证日志提示 unsigned executable | 把对应 Mach-O helper 加进 `mac.binaries` |
