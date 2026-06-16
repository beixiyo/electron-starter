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

正式发布配置直接写在 `electron-builder.yml` 的 `mac` 段，模板里不写 `identity`，避免把公司证书名提交到仓库

```yaml
appId: <app-id>
mac:
  # 不在模板里写 identity，避免把公司证书名提交到仓库
  # 正式发布时用 CSC_NAME 指定证书名；不设置时 electron-builder 会从钥匙串自动寻找可用身份
  # identity: 'Company (code)'
  entitlements: build/entitlements.mac.plist
  # Helper / Framework 子进程继承主 app 的签名权限
  entitlementsInherit: build/entitlements.mac.plist
  # Apple 公证要求启用 hardened runtime
  hardenedRuntime: true
  # extraResources 里的 Mach-O helper 需要显式签名
  binaries:
    - Contents/Resources/fn-listener
    - Contents/Resources/focus-check
    - Contents/Resources/audio-monitor
    - Contents/Resources/audio-recorder
  # 正式分发默认使用 electron-builder 内置公证
  notarize: true
```

`identity` 不填时，`electron-builder` 会优先读取 `CSC_NAME`；如果 `CSC_NAME` 也没设置，会从钥匙串自动寻找可用签名身份。正式发布建议显式设置 `CSC_NAME`，避免机器上有多个证书时选错

默认使用 `electron-builder` 内置公证即可。只有确认内置公证失败，并且错误发生在 `notarytool` 上传阶段，才考虑自定义 `afterSign` 调用 `notarytool submit --no-s3-acceleration`。它是网络 fallback，不是默认方案

## 3. 配置签名和公证凭证

正式分发需要两类凭证：

| 目的 | 环境变量前缀 | 什么时候用 |
|---|---|---|
| **签名** `.app` | `CSC_*` | 让 `codesign` 使用 *Developer ID Application* 证书 |
| **公证** 上传 Apple | `APPLE_*` | 让 `notarytool` 登录 Apple 公证服务 |

本机打包的推荐最小组合是：

```bash
export CSC_NAME='<developer-id-name>'

export APPLE_API_KEY="$HOME/Secrets/AuthKey_XXXXXXXXXX.p8"
export APPLE_API_KEY_ID='XXXXXXXXXX'
export APPLE_API_ISSUER='00000000-0000-0000-0000-000000000000'
```

### 3.1 签名凭证：`CSC_*`

如果 *Developer ID Application* 证书已经导入本机登录钥匙串，只需要指定证书名：

```bash
export CSC_NAME='<developer-id-name>'
```

`<developer-id-name>` 不要带 `Developer ID Application:` 前缀。例如钥匙串里看到：

```text
Developer ID Application: Example Company (ABCDE12345)
```

那这里填：

```bash
export CSC_NAME='Example Company (ABCDE12345)'
```

CI 或换机器打包时，才需要把证书和私钥导出成 `.p12`：

```bash
export CSC_LINK="$HOME/Secrets/Developer_ID_Application.p12"
export CSC_KEY_PASSWORD='p12 密码'
export CSC_NAME='<developer-id-name>'
```

`.p12` 是签名证书的搬运方式。本机钥匙串已经有证书和私钥时，不需要 `CSC_LINK` / `CSC_KEY_PASSWORD`

### 3.2 公证凭证：`APPLE_*`

公证推荐使用 **App Store Connect API Key**。这是给 `notarytool` 上传公证用的，和 `CSC_*` 不是一类东西

创建入口：
https://appstoreconnect.apple.com/access/integrations/api

创建步骤：

1. 用有权限的 Apple Developer / App Store Connect 账号登录
2. 打开 **Users and Access**
3. 进入 **Integrations** → **App Store Connect API**
4. 点击 `+` 创建 **Team Key**，不要创建 Individual Key
5. 权限选择 **App Manager**
6. 记录 **Key ID** 和 **Issuer ID**
7. 下载 `AuthKey_<Key ID>.p8`

`.p8` 私钥只能下载一次，下载后放到本机安全目录或 CI Secret，不要提交到仓库

环境变量对应关系：

```bash
export APPLE_API_KEY="$HOME/Secrets/AuthKey_XXXXXXXXXX.p8"     # .p8 文件绝对路径
export APPLE_API_KEY_ID='XXXXXXXXXX'                            # Key ID
export APPLE_API_ISSUER='00000000-0000-0000-0000-000000000000'  # Issuer ID
```

如果不使用 API Key，也可以改用 Apple ID 应用专用密码。这是 **API Key 的替代方案**，不要和 `APPLE_API_*` 同时混用：

```bash
export APPLE_ID='your-apple-id@example.com'
export APPLE_APP_SPECIFIC_PASSWORD='xxxx-xxxx-xxxx-xxxx'
export APPLE_TEAM_ID='<team-id>'
```

### 3.3 该选哪组

| 场景 | 签名 | 公证 |
|---|---|---|
| 本机已有证书 | `CSC_NAME` | `APPLE_API_KEY` + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER` |
| CI / 新电脑没有证书 | `CSC_LINK` + `CSC_KEY_PASSWORD` + `CSC_NAME` | `APPLE_API_KEY` + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER` |
| 不想建 API Key | `CSC_NAME` 或 `.p12` 那组 | `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID` |

不要把 `.p12`、`.p8`、密码或 token 写进仓库

## 4. 打包

如果用 zsh 手动 `export` 环境变量，变量只对当前终端会话有效。打包前先确认当前 shell 能读到凭证和证书：

```bash
echo "$APPLE_API_KEY"
echo "$APPLE_API_KEY_ID"
echo "$APPLE_API_ISSUER"
security find-identity -v -p codesigning
```

如果在公司网络中打包，先确认 Apple timestamp 链路。`codesign` 需要能访问 `timestamp.apple.com`，否则正式签名会失败：

可以直接运行项目内置检查脚本：

```bash
bash ./packages/app/scripts/check-mac-official-signing.sh
```

也可以手动执行下面的最小检查：

```bash
tmp="$(mktemp -d)"
cp /bin/echo "$tmp/echo"

codesign \
  --sign 'Developer ID Application: Example Company (ABCDE12345)' \
  --force \
  --timestamp \
  --options runtime \
  "$tmp/echo"
```

如果报 `The timestamp service is not available`，优先检查 DNS。公共 DNS 例如 `8.8.8.8` 可能绕过公司网关的 fake-ip / 透明代理 DNS，导致 `timestamp.apple.com` 直连 Apple 真实 IP 后被 reset

```bash
networksetup -getdnsservers Wi-Fi
dig +short timestamp.apple.com A
```

如果同一网络里的 Linux / Arch 能成功，可以对比它的 DNS：

```bash
cat /etc/resolv.conf
ip route get 1.1.1.1
```

当 Linux 使用网关 DNS，例如 `198.18.0.2`，而 Mac 使用 `8.8.8.8` 时，可以临时把 Mac 改成同一个网关 DNS：

```bash
networksetup -setdnsservers Wi-Fi 198.18.0.2
dscacheutil -flushcache
killall -HUP mDNSResponder 2>/dev/null || true
```

再跑 `codesign --timestamp`。如果成功，说明根因是 DNS 绕过网关，不需要开启 Clash Verge 系统代理

测试环境打包：

```bash
pnpm -F app build:mac:test
```

生产环境打包：

```bash
pnpm -F app build:mac:prod
```

electron-builder 会执行：

1. 签名 `.app`
2. 上传 Apple 公证
3. stapler 钉装公证票据
4. 生成 `.dmg` / `.zip`

构建命令成功只代表流程跑完，发布前还要执行下一节验证

## 5. 验证

```bash
APP="$(find packages/app/dist/dist -name '<app-name>.app' -type d | head -n 1)"

codesign --verify --deep --strict --verbose=2 "$APP"
codesign -dv --verbose=4 "$APP" 2>&1 | grep -E 'Authority=|TeamIdentifier='
spctl --assess --type execute --verbose=4 "$APP"
xcrun stapler validate "$APP"
xcrun stapler validate packages/app/dist/dist/*.dmg
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
| `The timestamp service is not available` | 当前网络无法访问 Apple 时间戳服务。优先检查 DNS 是否绕过公司网关 fake-ip DNS；这不是依赖或 dist 缓存问题 |
| `The Internet connection appears to be offline` | `notarytool` 上传或等待 Apple 公证结果时网络中断。保持网络稳定后重跑；手机热点休眠、切后台、距离过远都可能导致这一步失败 |
| 公证 401 | 检查 API Key / Issuer ID / Key ID，或 Apple ID 应用专用密码和 Team ID |
| 公证日志提示 unsigned executable | 把对应 Mach-O helper 加进 `mac.binaries` |

如果 DNS 修正后 `codesign --timestamp` 已成功，但内置公证仍在上传阶段失败，再考虑 `notarytool submit --no-s3-acceleration`。这个参数只影响公证上传，不解决 timestamp 阶段
