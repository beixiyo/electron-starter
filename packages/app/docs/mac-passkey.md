# macOS Passkey（Touch ID）实现

本文档讲**代码侧**如何让 Electron 应用支持 Passkey / Touch ID 登录（WebAuthn 平台认证器）

签名与授权侧（entitlement、provisioning profile、Helper 拆分）是它的**前置依赖**，单独放在 [mac-managed-capabilities.md](./mac-managed-capabilities.md)。两者缺一不可：代码写对了但没配签名，app 启动就被系统杀；签名配好了但没写代码，网页里的 passkey 请求不会走到 Touch ID

> ## ⚠️ 适用范围（先看这段，血泪教训）
>
> Electron 的 `configureWebAuthn({ touchID })` 造的是一个**绑定本机 Secure Enclave 的认证器，凭据存在你 app 自己的 keychain group 里，与 iCloud 钥匙串完全隔离**。Electron 官方原话：*Touch ID WebAuthn credentials are device-bound and are NOT synced via iCloud Keychain*。
>
> **能做**：你**自己服务**的 passkey 登录（RP = 你的域名），用户在你的 app 里注册(`create`)、再登录(`get`)。
>
> **不能做**：用用户**已有的系统 / iCloud 钥匙串 passkey** 登录。最典型的就是 **"Sign in with Apple"（`appleid.apple.com`）**——它要的是 iCloud 钥匙串里的 Apple passkey，本认证器根本看不到，`navigator.credentials.get()` 会以 `status 2 from TouchIdAuthenticator`（无匹配凭据）失败，表现为"转一下就没了"。
>
> **Sign in with Apple 的正确做法**：走 **OAuth + 系统浏览器 + 自定义协议 deeplink 回调**，不是本文档这套。即用 `shell.openExternal` 打开 Apple 授权 URL（真浏览器里 passkey/2FA 才能用），Apple 回调到你的 https 端点（Apple 强制 https，不接受 `app://` / localhost），再由该端点 302 跳回 `yourapp://...`，app 用 `open-url` 接住。这需要一个最小 https 端点（serverless 或 BaaS 代管）。
>
> 一句话：**本文档 = 你自己的 passkey；Sign in with Apple 走 OAuth，别用这套。**

## 整体架构

Passkey 不是你自己实现的，而是把三方接起来：

```
登录网页（渲染进程/远程页面）
  navigator.credentials.create() / .get()   ← 标准 Web WebAuthn，你不用改
        │
        ▼
Chromium（Electron 内置）
        │  app.configureWebAuthn 把平台认证器接进来
        ▼
macOS Secure Enclave / Touch ID
  凭据（passkey）存进 keychain-access-group
```

要点：

- **凭据发起在网页里**，用的是浏览器标准 `navigator.credentials` API——如果你的登录页在浏览器里能用 passkey，代码层面基本不用改
- **主进程只做一件事**：调用 `app.configureWebAuthn(...)` 打开 macOS 平台认证器，并告诉它 passkey 存哪个 keychain group
- **RP ID（Relying Party ID）= 登录页的域名**（如 `example.com`），由网页 origin 决定，不是你在原生侧配的

## 前提

- **Electron 版本**：需要内置 `app.configureWebAuthn` 的版本（本模板 42.x 已内置）。旧版本没有此 API，下面的 setup 会走 `catch` 分支静默降级——不报错但 Touch ID 不生效。可用 `typeof app.configureWebAuthn === 'function'` 判断
- **平台**：仅 macOS。其它平台直接跳过
- **签名**：必须完成 [mac-managed-capabilities.md](./mac-managed-capabilities.md) 的 entitlement + profile + Helper 拆分，否则 app / Helper 启动被 SIGKILL

## 1. 集中常量，避免 entitlement 与代码不同步

keychain group 的值必须和 `keychain-access-groups` entitlement **一字不差**。用一个常量从 Team ID + Bundle ID 推导，两边都引它：

```ts
// shared/constants/app-protocol.ts
export const APP_BUNDLE_ID = '<app-id>'      // 与 electron-builder.yml 的 appId 一致
export const APPLE_TEAM_ID = '<team-id>'

/** macOS WebAuthn / Touch ID 凭据存储使用的 Keychain Access Group */
export const WEB_AUTHN_KEYCHAIN_ACCESS_GROUP = `${APPLE_TEAM_ID}.${APP_BUNDLE_ID}.webauthn`
```

对应 `build/entitlements.mac.plist` 里（值必须与上面算出来的一致）：

```xml
<key>keychain-access-groups</key>
<array>
  <string><team-id>.<app-id>.webauthn</string>
</array>
```

> Electron 官方对 `keychainAccessGroup` 的说明：must also be present in your app's `keychain-access-groups` entitlement, typically of the form `<TEAM_ID>.<BUNDLE_ID>.webauthn`

## 2. 主进程：开启 Touch ID 平台认证器

在 **app ready 之后**调用（`configureWebAuthn` 需要 app 已就绪）。放在你现有的 ready 回调里：

```ts
import { app, session } from 'electron'
import { WEB_AUTHN_KEYCHAIN_ACCESS_GROUP } from '@shared'

function setupWebAuthn(): void {
  if (process.platform !== 'darwin') {
    return
  }

  try {
    app.configureWebAuthn({
      touchID: {
        keychainAccessGroup: WEB_AUTHN_KEYCHAIN_ACCESS_GROUP,
        // 弹窗文案：macOS 渲染成 `"<App Name>" is trying to <promptReason>`
        // $1 会被替换成请求的 RP ID（如 example.com）
        promptReason: 'sign in to $1',
      },
    })

    // 有多个可选 passkey 时，系统通过这个事件让你选一个账号
    session.defaultSession.on('select-webauthn-account', (_event, details, callback) => {
      // details.relyingPartyId：本次请求的 RP ID
      // details.accounts：WebAuthnAccount[]，每个含 credentialId / name / displayName
      const credentialId = details.accounts.length === 1
        ? details.accounts[0]?.credentialId
        : undefined

      // 必须且只能调用一次；传 undefined/null 视为取消（NotAllowedError）
      callback(credentialId)
    })
  }
  catch (error) {
    // 旧版 Electron 无此 API，或配置失败：降级，不影响其余启动流程
    log.warn('[webauthn] setup failed', error)
  }
}
```

关键点：

- `configureWebAuthn` 只需调一次
- `select-webauthn-account` 的 `callback` **必须恰好调用一次**，否则请求会一直挂起。单账号可直接选中；多账号应弹 UI 让用户选，再回传选中的 `credentialId`。这里的简化实现是「只有一个就自动选，多个则取消」——需要多账号选择 UI 时在此扩展

## 3. 渲染 / 网页侧：标准 WebAuthn，通常无需改动

登录页里就是普通的 Web WebAuthn 调用，Chromium 会自动路由到 Touch ID：

```js
// 注册（创建 passkey）
await navigator.credentials.create({ publicKey: { /* rp / user / challenge ... */ } })

// 登录（使用 passkey）
await navigator.credentials.get({ publicKey: { /* challenge / rpId ... */ } })
```

- 这些 `publicKey` 选项一般由你的**后端**下发（challenge、rp、user 等），前端原样传入
- **RP ID 必须与登录页域名匹配**（WebAuthn 安全要求）。因此 passkey 只在通过 `https://` 或你的自定义协议加载、且 origin 稳定的登录页上可用；本地 `file://` / 频繁变化的 origin 不适合做 RP

## 4. 依赖的签名配置（务必先完成）

见 [mac-managed-capabilities.md](./mac-managed-capabilities.md)，三件事缺一不可：

1. 注册匹配 `<app-id>` 的 Explicit App ID，生成并内嵌 **Developer ID provisioning profile**
2. `build/entitlements.mac.plist` 里声明 `keychain-access-groups`（值 = 第 1 节的常量）
3. **拆分 `entitlementsInherit`**：Helper 用不含 keychain-access-groups 的独立文件，否则 Helper 被 SIGKILL、app 白屏

## 5. 验证与排查

| 现象 | 可能原因 |
|---|---|
| app / 白屏起不来，`exit 137` | 签名侧没配好，见 [mac-managed-capabilities.md](./mac-managed-capabilities.md)（profile 没内嵌 / Helper 没拆） |
| 登录页点 passkey，**没弹 Touch ID** | `setupWebAuthn` 没在 ready 后调用；或旧版 Electron 走了 catch；或 `process.platform` 提前 return |
| Touch ID 弹了但报 `NotAllowedError` | `select-webauthn-account` 的 callback 没调用 / 传了空 / 传了不匹配的 credentialId |
| 提示找不到凭据 | RP ID 与登录页域名不匹配，或该设备上还没注册过 passkey（先走 `create()`） |
| 弹窗文案不对 | 调整 `promptReason`，注意是小写句子片段、`$1` = RP ID |

快速自检（打包后）：

```bash
# 主进程带 keychain（应为 1），Helper 不带（应为 0）
codesign -d --entitlements - "<app>.app/Contents/MacOS/<app-name>" 2>/dev/null | grep -c keychain
codesign -d --entitlements - "<app>.app/Contents/Frameworks/<app-name> Helper.app/Contents/MacOS/<app-name> Helper" 2>/dev/null | grep -c keychain
```

## 常见误区

- **以为需要 Associated Domains**：Touch ID **平台认证器**（本方案）靠 keychain group 存凭据、靠网页 origin 校验 RP，**不需要** Associated Domains 或 `apple-app-site-association`。Associated Domains 是另一套（原生 AutoFill / 让 app 代理某域名的 passkey）
- **以为要装第三方 WebAuthn 库**：Electron 内置 `configureWebAuthn` 后，平台认证器就是浏览器原生能力，登录页用标准 API 即可，无需 `@simplewebauthn` 之类的原生桥接库
- **keychain group 值写错**：必须 `<TEAM_ID>.<BUNDLE_ID>.webauthn` 且与 entitlement 完全一致，用常量收口
- **只改主进程忘了 Helper**：见签名文档第 3 步，这是最容易漏、且表现为"能起来但白屏"的坑
