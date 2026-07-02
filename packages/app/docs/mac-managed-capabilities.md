# macOS 受管能力与 Provisioning Profile

本文档处理一类特殊情况：应用用到了 **managed capability（受管能力）**，最典型的是 `keychain-access-groups`（Touch ID passkey / 钥匙串共享），此外还有 Associated Domains、App Groups、Push 等

这类能力对 App Store 外分发（Developer ID）有额外要求：主 app 必须**内嵌一个 Developer ID provisioning profile**，否则即使签名和公证都正确，应用启动瞬间也会被系统杀掉

普通打包（不涉及这些能力）走 [mac-official-signing.md](./mac-official-signing.md) 即可，不需要 provisioning profile

本文档只讲**签名 / 授权侧**。Passkey（Touch ID）的**代码侧实现**（`app.configureWebAuthn` 等）见 [mac-passkey.md](./mac-passkey.md)

> 本文档的流程与坑点均为实测验证，不是照抄通用教程

## 症状

签名、公证全部正常，但双击应用报「应用程序"XXX.app"无法打开」，命令行直接跑二进制返回 `exit 137`（`128 + 9`，即被 `SIGKILL`）：

```bash
XXX.app/Contents/MacOS/XXX; echo "exit=$?"   # exit=137
```

同时下面这些**全部显示正常**，极易误判成签名或 Gatekeeper 问题：

```bash
codesign --verify --deep --strict XXX.app          # valid on disk
spctl --assess --type execute --verbose=4 XXX.app  # accepted, Notarized Developer ID
```

真因：`entitlements` 里声明了受管能力（如下），但 `.app` 里没有 `Contents/embedded.provisionprofile` 授权它

```xml
<key>keychain-access-groups</key>
<array>
  <string><team-id>.<app-id>.webauthn</string>
</array>
```

## 原理

`keychain-access-groups` 这类属于 Apple 说的 **managed capability**。对 Developer ID 分发，它必须由一个 Developer ID provisioning profile 授权，而且这个 profile 会在**每次启动时**被内核（AMFI）校验，不是只在安装时

> Apple 官方（Developer ID certificates 文档）：If your application utilizes a Developer ID provisioning profile to support advanced capabilities, then that profile is also evaluated, both at app installation time and **at every app launch**.

所以没内嵌 profile → 每次启动都被 AMFI 判为「携带未授权受限权限的非法应用」→ 直接 `SIGKILL`

Developer ID provisioning profile（2017-02-22 之后生成的）有效期 18 年，和证书有效期无关；但 **profile 过期后应用将无法启动**

## 占位符

沿用 [mac-official-signing.md](./mac-official-signing.md) 的占位符：

| 占位符 | 含义 | 从哪查 |
|---|---|---|
| `<team-id>` | Apple Developer Team ID，例如 `ABCDE12345` | `codesign -dv <app>` 的 `TeamIdentifier=` |
| `<app-id>` | 应用真实 Bundle ID，例如 `com.example.app` | `electron-builder.yml` 的 `appId`，或 `codesign -dv <app>` 的 `Identifier=` |
| `<app-name>` | `.app` 名称，通常等于 `productName` | |

## 1. 注册一个精确匹配的 Explicit App ID

Developer ID 签名/公证**本身不需要注册 App ID**（任意 bundle id 都能签），所以你的账号里很可能**根本没有** `<app-id>` 这个 Identifier——这是正常的，不是出错。但一旦要用受管能力，就必须补一个**和应用真实 Bundle ID 一字不差**的 App ID

1. 打开 `https://developer.apple.com/account/resources/identifiers/list`
2. 点右上角 **➕** → 选 **App IDs** → Continue
3. 类型选 **App** → Continue
4. **Description** 随便填（如 `<app-name> Desktop`）
5. **Bundle ID** 选 **Explicit**，填 `<app-id>`（必须和应用真实 bundle id 完全一致，别填成同名的其它 id）
6. Capabilities **什么都不用勾**

> ⚠️ 门户里**没有** "Keychain Sharing" 这个开关——它是 Xcode 侧的概念。`keychain-access-groups` 会由 provisioning profile 以 `<team-id>.*` 通配的形式**自动包含**，不需要在 App ID 上手动开。（Associated Domains / App Groups 等则需要在此手动勾选对应能力）

7. Continue → **Register**

## 2. 生成 Developer ID provisioning profile

1. 打开 `https://developer.apple.com/account/resources/profiles/list`
2. 点 **➕**
3. 在 **Distribution** 分组里选 **Developer ID**（不是 Mac App Store，也不是 Development）
4. 选择刚注册的 App ID `<app-id>`
5. **选证书（单选，且这里有坑）**：见下方「证书要匹配本机签名证书」
6. 命名并生成，下载 `.provisionprofile`

### 证书要匹配本机签名证书（易错）

这一步是**单选**。如果你重复申请过 Developer ID Application 证书，列表里会出现**多张同名、甚至同到期日**的证书，肉眼无法区分。profile 里包含的证书**必须是你打包时实际用来签名的那一张**，否则应用签好后仍被 AMFI 杀（signing cert 不在 profile 的允许列表里）

先查出本机唯一可签名的证书指纹（`find-identity` 只列出带私钥、能签名的）：

```bash
security find-identity -v -p codesigning | grep "Developer ID Application"
# 记下前面的 40 位 SHA-1，例如 D57A77C7...
```

选一张生成、下载后，**验证 profile 里是否包含这张证书**，不含就换一张重来：

```bash
python3 - <<'PY' /path/to/downloaded.provisionprofile
import sys, subprocess, plistlib, hashlib
raw = subprocess.run(["security","cms","-D","-i",sys.argv[1]], capture_output=True).stdout
pl = plistlib.loads(raw[raw.find(b"<?xml"):])
print("App ID:", pl["Entitlements"].get("com.apple.application-identifier"))
print("keychain:", pl["Entitlements"].get("keychain-access-groups"))
target = "填你上一步记下的 SHA-1（大写无冒号）"
ok = any(hashlib.sha1(d).hexdigest().upper()==target for d in pl.get("DeveloperCertificates",[]))
print("含本机签名证书:", "OK" if ok else "NO -> 换一张证书重新生成")
PY
```

预期看到 App ID = `<team-id>.<app-id>`、keychain = `<team-id>.*`、且「含本机签名证书: OK」

## 3. 配置 electron-builder.yml（含 Helper 关键坑）

```yaml
mac:
  entitlements: build/entitlements.mac.plist
  # Helper 继承权限必须用独立文件，且不含 keychain-access-groups（见下）
  entitlementsInherit: build/entitlements.mac.inherit.plist
  hardenedRuntime: true
  notarize: true
  # 受管能力必须内嵌 profile，否则启动被 SIGKILL
  provisioningProfile: build/<app-name>_developer_id.provisionprofile
```

把下载的 `.provisionprofile` 放进 `build/`。electron-builder 会把它内嵌成主 app 的 `Contents/embedded.provisionprofile`

### ⚠️ Helper 子进程也会被杀（务必拆分 entitlementsInherit）

provisioning profile **只内嵌到主 app**，不会进每个 Helper（Renderer/GPU/Plugin）。如果 `entitlementsInherit` 和 `entitlements` 指向同一个文件，Helper 就会**继承到 keychain-access-groups 却没有 profile 授权**，被 AMFI 在启动时 `SIGKILL`，表现为主 app 能起来但白屏 / 崩溃

实测对照（同一 Helper 二进制）：

| Helper 权限 | 直接运行结果 |
|---|---|
| 带 keychain-access-groups，无 profile | `exit 137`（SIGKILL，被 AMFI 杀）|
| 去掉 keychain-access-groups | `exit 134`（SIGABRT，通过 AMFI，只是独立进程缺 IPC 上下文自退，正常）|

因此必须建一个**独立的 `build/entitlements.mac.inherit.plist`**，内容与主 entitlements 一致、**唯独去掉 `keychain-access-groups`**。Touch ID passkey 的钥匙串访问发生在主进程（browser process），Helper 不需要该权限

## 4. 两个 entitlements 文件的分工

`build/entitlements.mac.plist`（主 app，含受管能力）：

```xml
<key>keychain-access-groups</key>
<array>
  <string><team-id>.<app-id>.webauthn</string>
</array>
<!-- 以及 cs.allow-jit / device.* / files.* 等原有项 -->
```

`build/entitlements.mac.inherit.plist`（Helper，去掉受管能力）：

```xml
<!-- 与主文件相同，但没有 keychain-access-groups -->
<key>com.apple.security.cs.allow-jit</key><true/>
<key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
<key>com.apple.security.cs.allow-dyld-environment-variables</key><true/>
<!-- ...其余按需保留... -->
```

## 5. 验证

```bash
APP="$(find packages/app/dist/dist -name '<app-name>.app' -type d | head -n 1)"

# 1. 主 app 内嵌了 profile
ls "$APP/Contents/embedded.provisionprofile"

# 2. 主 app 带 keychain（输出 1），Helper 不带（输出 0）
codesign -d --entitlements - "$APP/Contents/MacOS/<app-name>" 2>/dev/null | grep -c keychain
codesign -d --entitlements - "$APP/Contents/Frameworks/<app-name> Helper.app/Contents/MacOS/<app-name> Helper" 2>/dev/null | grep -c keychain

# 3. profile 授权的 entitlements
security cms -D -i "$APP/Contents/embedded.provisionprofile" | plutil -p - | grep -A5 Entitlements

# 4. 真正启动（不再 exit 137），并实测受管能力（如 Touch ID passkey 弹窗）
open "$APP"
```

## 常见问题

| 问题 | 处理 |
|---|---|
| 账号里没有 `<app-id>` 这个 App ID | 正常，Developer ID 签名不需要注册；用受管能力才要补，见第 1 步 |
| Profiles 里选证书是单选、多张同名分不清 | 按第 2 步「证书要匹配本机签名证书」验证选对没 |
| 主 app 修好了但白屏 / 崩溃 | Helper 没拆 `entitlementsInherit`，见第 3 步 |
| 加了 profile 仍 `exit 137` | 确认 profile 真内嵌、且里面的证书 = 本机签名证书；确认 Helper 已去掉受管权限 |
| profile 过期后应用打不开 | Developer ID profile 过期会导致无法启动，需重新生成并重打包 |
| 直接分发仍被杀（罕见） | 见下方「直接分发的坑」 |

## 直接分发的坑

Apple 论坛有案例：profile 已授权 `keychain-access-groups`，但**直接分发**（非 MAS）的包启动仍被 `taskgated` 报 `Unsatisfied entitlements` 杀掉，尤其在同时用 App Extension / App Groups 时。Apple DTS（Quinn）的规避建议是改用 **iOS 风格的 group ID**（`group.xxx` 形式）来配合受限权限

因此如果按上面配好、profile 也正确、Helper 也拆了，应用还是起不来，优先怀疑 group 命名，往这个方向调

## 先确认是否真的需要

加受管能力之前先确认业务上真的用得到，避免白折腾一套 App ID + profile：

- **Touch ID passkey（Electron `app.configureWebAuthn({ touchID: { keychainAccessGroup } })`）**：**需要** `keychain-access-groups`，passkey 凭据就存在这个 group 里，走本文档流程
- **仅普通网页 WebAuthn / 外接安全钥匙**：Chromium 自带，通常**不需要**自定义 keychain group
- **需要列出系统 passkey / 当浏览器级凭据提供方**：那是另一个权限 `com.apple.developer.web-browser.public-key-credential`（受管能力，需 Apple 审批），和本文档的 keychain group 不是一回事

用不上就从 entitlements 删掉对应 key，不必走本文档的 profile 流程
