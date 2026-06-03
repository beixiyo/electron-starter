# macOS 代码签名与 TCC 授权 —— 打包后 Fn 快捷键失效的根因与修复

> 配套脚本：[`scripts/selfsign-app.ts`](../scripts/selfsign-app.ts)（自签名验证用）
> 关联文档：[`fn-key.md`](./fn-key.md)、[`fn-key-investigation.md`](./fn-key-investigation.md)（Fn 监听本身的实现）

---

## 0. 一句话结论

> ✅ **已现场验证（2026-06-02）**：把 app 用自签名证书签好、挪到 `~/Applications` 后，授权辅助功能一次 → 双击启动 Fn 长按/双击/组合键全部可用，授权稳定粘住、不再循环。判定实验副产物：Launchpad 出现两个同名 `electron-app`，只有「自签名那份」能用、ad-hoc 那份不行 —— 因为 TCC 授权绑的是**签名 DR**（`identifier + 证书根`），不是名字/路径（详见第三节）

打包后双击启动 Fn 失效，**不是代码问题、不是权限弹窗问题，是签名问题**：

- 默认打包是 **ad-hoc 签名**，TCC（系统授权数据库）把「辅助功能」授权按 **cdhash** 绑定，cdhash 每次构建都变、且 ad-hoc 身份不稳定 → 你在系统设置里点了「开」，**实际绑不准、不生效** → 表现为「授权了也没用」
- 修复 = 给 app 一个**稳定的代码签名身份**。授权改按 **DR（指定要求）= bundle id + 证书** 绑定，一次授权跨重建复用、双击启动也生效
- 本机验证用**自签名证书**即可（本文第二节）；分发到别人电脑必须用**正规 Developer ID 证书 + 公证**（第四节）

---

## 1. 概念地图（先把这些词搞清楚）

### 1.1 几种「签名身份」

| 身份类型 | `Identifier` / `Authority` | 谁签的 | 能干嘛 | TCC 授权稳不稳 |
|---|---|---|---|---|
| **ad-hoc**（默认打包） | `Electron` / `(adhoc)` | 没有证书，只算哈希 | 能本机跑 | ❌ 按 cdhash，**每次构建变、绑不准** |
| **自签名**（本文验证用） | `com.你的.id` / 你的自签证书 | 你自己用 openssl 造的证书 | 本机跑、**TCC 授权稳定** | ✅ 按 bundle id + 证书根 |
| **Apple Development** | `com.你的.id` / `Apple Development: 你` | Apple（开发用） | 本机/团队设备调试 | ✅ 稳定 |
| **Developer ID Application** | `com.你的.id` / `Developer ID Application: 公司(TEAMID)` | Apple（分发用） | **能公证、别人电脑能装** | ✅ 稳定 |

> 关键认知：**TCC 授权稳不稳，只取决于「有没有稳定签名身份」，跟证书是不是 Apple 签发的无关。** 所以本机验证自签名就够；Apple 证书的额外价值是「能过 Gatekeeper / 公证 / 分发」

### 1.2 三件容易混的事（**别搞混**）

| 概念 | 管什么 | 失败现象 | 本案相关吗 |
|---|---|---|---|
| **代码签名** | 给 app 一个身份 | 没身份 → TCC 绑不准 | ✅ **核心** |
| **公证 notarization** | Apple 扫描盖章 | 没公证 → 别人电脑 Gatekeeper 拦 | 仅「分发到别人电脑」才需要 |
| **Gatekeeper** | 首次打开时校验来源 | 拦截「来路不明」 app | 本机自己构建的不触发（无隔离属性） |

本机自己 build 的 app **没有** `com.apple.quarantine` 隔离属性 → Gatekeeper 不评估 → 所以**自签名(不公证)在本机能直接双击启动**

### 1.3 DR（Designated Requirement，指定要求）

DR 是签名里写死的一句「**怎样才算还是我**」的规则。TCC 就是拿它判定「这个 app 是不是我授权过的那个」

```
ad-hoc：   designated => identifier "Electron" and cdhash H"xxxx..."   ← cdhash 每次构建都变 → 授权失配
自签名：   designated => identifier "com.example.app" and certificate root = H"719e..."  ← 只要 bundle id 和证书不变就稳定
```

### 1.4 Library Validation（库验证）

**hardened runtime（强化运行时）** 开启后会强制 **Library Validation**：进程只能加载「和主程序同一 Team ID」或「Apple 签」的库

- 自签名**没有 Team ID** → 开着 hardened runtime 时加载 Electron 框架会因 LV 失败而**崩溃**
- 所以本机自签名重签时**不带 hardened runtime**（`codesign` 不加 `--options runtime`），LV 就不强制，app 正常加载
- 生产用 Developer ID 时，electron-builder 会把 Electron 框架也用你的证书重签 → 全部同一 Team ID → LV 自动通过，**无需** disable-library-validation

---

## 2. 我实际做了什么（自签名验证，逐条命令 + 预期输出 + 坑）

> 一键复跑：`bun scripts/selfsign-app.ts setup` 然后 `bun scripts/selfsign-app.ts sign <app>`
> 下面拆开讲每一步**改了系统什么、为什么、踩了什么坑**

### 步骤 1：生成自签名证书

```bash
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout key.pem -out cert.pem -days 3650 \
  -subj "/CN=Local CodeSign/O=Local CodeSign" \
  -addext "basicConstraints=critical,CA:false" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning"   # ← codesign 只认带这个 EKU 的证书
```

- **改了什么**：在当前目录生成 `key.pem`（私钥）+ `cert.pem`（证书）
- **坑①**：少了 `extendedKeyUsage=codeSigning` 这条，`codesign` 不会把它当代码签名证书

### 步骤 2：导出成 p12

```bash
openssl pkcs12 -export -legacy -inkey key.pem -in cert.pem \
  -out cs.p12 -passout pass:localsign -name "Local CodeSign"
```

- **坑②（必记）**：**openssl 3.x 必须加 `-legacy`**。否则它用新加密算法打包，macOS 的 `security import` **读不了**，报错 `MAC verification failed` 之类

### 步骤 3：导入独立钥匙串

```bash
KC="$HOME/Library/Keychains/local-codesign.keychain-db"
security create-keychain -p localsign "$KC"
security set-keychain-settings "$KC"                  # 关掉自动锁定，免得签到一半锁了
security unlock-keychain -p localsign "$KC"
security import cs.p12 -k "$KC" -P localsign -T /usr/bin/codesign -A
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k localsign "$KC"
```

- **为什么用独立钥匙串**而不是 login 钥匙串：独立钥匙串密码我自己定（`localsign`），可以用 `set-key-partition-list` **非交互地**放行 codesign 用私钥 → 签名时**不弹 GUI 授权框**。用 login 钥匙串则要你的开机密码才能设 partition-list，会卡 GUI 弹窗
- `-A` = 允许任意程序用这个私钥（配合 partition-list 彻底免弹窗）

预期输出：`1 identity imported.`

### 步骤 4：把钥匙串加进搜索列表 ←（坑③，最关键）

```bash
EXISTING=$(security list-keychains -d user | sed -e 's/^[[:space:]]*//' -e 's/"//g')
security list-keychains -d user -s "$KC" $EXISTING    # 前插，保留原有，非破坏
```

- **坑③**：只导入还不够。`codesign` 找签名身份是**按搜索列表找的**，钥匙串不在列表里 → 即使按 hash 指定也报：

  ```
  719E699CB4BF1565DB50DD170C8CFA446FA12C33: no identity found   ← 就是这个坑
  ```

  加进搜索列表后，按名字就签上了。**注意 `$EXISTING` 要带上原有的 login 钥匙串，否则会把你的默认钥匙串挤出列表**（本脚本已处理）

### 步骤 5：看身份状态 ←（坑④，吓人但无害）

```bash
security find-identity -p codesigning "$KC"
```

预期输出：

```
1) 719E699CB4BF1565DB50DD170C8CFA446FA12C33 "Local CodeSign" (CSSMERR_TP_NOT_TRUSTED)
   1 identities found
   Valid identities only
   0 valid identities found       ← 别慌
```

- **坑④**：`CSSMERR_TP_NOT_TRUSTED`、`0 valid identities` 看着像坏了，**但不影响签名**
  - **签名**只用私钥，**不查信任** → 自签名照样能签
  - 「受信/valid」只在两处才有用：① **Gatekeeper 验证**（分发时）；② **electron-builder 的 `-v` 校验**（所以下面我们**绕过 electron-builder 的签名**，直接用 `codesign` 手签）

### 步骤 6：用它重签 .app

先正常打包（electron-builder 见到非 Apple 证书会**主动 skip 签名**，留 ad-hoc，无所谓）：

```
• skipped macOS application code signing  reason=cannot find valid "Developer ID Application" identity...
```

然后手动 `--deep` 重签整个 bundle：

```bash
xattr -dr com.apple.quarantine "$APP"        # 去隔离属性（本地构建一般本就没有）
codesign --deep --force -s "Local CodeSign" "$APP"   # 不带 --options runtime
```

- **`--deep`**：连 `Electron Framework`、4 个 Helper、4 个 swift 二进制一起重签，保证整包一致
- **坑⑤**：**不要带 `--options runtime`**（hardened runtime）。自签名没 Team ID，开 hardened runtime 会触发 Library Validation → 加载 Electron 框架时崩溃。本机验证不带它最稳

### 步骤 7：校验 DR

```bash
codesign --verify --deep --verbose=2 "$APP"      # → satisfies its Designated Requirement
codesign -dvvv "$APP" 2>&1 | grep -E "Identifier=|Authority="
codesign -d --requirements - "$APP"
```

预期（**这就是「证书怎么签上的」的证据**）：

```
Identifier=com.example.app
Authority=Local CodeSign
designated => identifier "com.example.app" and certificate root = H"719e699cb4bf1565db50dd170c8cfa446fa12c33"
```

✅ 身份从 `Electron(adhoc)` 变成了 `com.example.app + 自签证书`，DR 稳定

### 步骤 8：重置 TCC + 授权 + 测试

```bash
tccutil reset Accessibility com.example.app   # 清掉旧记录（scoped，不动别的 app）
open "$APP"                                                # open 走 launchd = 等价 Finder 双击
```

- 然后「系统设置 → 隐私与安全性 → 辅助功能」里把这个 app 打开 → `Cmd+Q` 退出 → 重新 `open` → 测 Fn
- **坑⑥**：**TCC 授权改动要 app 重启才生效**。fn-listener 在没授权时 `CGEventTap` 创建失败会退出，所以授权后**必须重启 app** 才会带权限重新拉起
- **坑⑦**：`open` / Finder 双击走 launchd，责任进程是 app **自己**；而从终端直接跑 `.../MacOS/electron-app` 会**借终端的授权**，是假象。判定一定要用 `open` 或双击

---

## 3. 为什么自签名能修好（原理小结）

| | ad-hoc（坏） | 自签名（好） |
|---|---|---|
| DR 绑定依据 | `cdhash`（每次构建变） | `identifier + 证书根`（稳定） |
| 授权后果 | 系统设置显示「开」但**绑不准/不生效** | **授权一次粘住、双击也生效** |
| 多份同名 app | 都叫 `Electron`，被去重挤成一条，绑乱 | bundle id 唯一，干净 |

**核心**：TCC 不查 Gatekeeper、不查证书是否 Apple 签发，它只认 **DR**。给一个稳定 DR，授权就稳

**自签名的边界（务必知道）**：
- ❌ 过不了 **Gatekeeper** / **公证** → 拷到**别人电脑**双击会被拦（"来自身份不明的开发者"/"已损坏"）
- ✅ 只在**本机**（无隔离属性、签名结构合法）能直接跑 → **仅用于验证根因**
- 分发给团队几十人 → 必须走第四节的 Developer ID + 公证

---

## 4. 生产正规做法（Developer ID 证书 + 公证）

### 4.1 向 iOS 团队要什么

> 你们已有 Apple 开发者团队，把下面这段直接转发即可：

1. **一张「Developer ID Application」证书** ⚠️ **不是** iOS Distribution / Apple Distribution（那种签不了 Mac 外发 app）。两种给法二选一：
   - 把我加进团队（能管证书的角色），我用 Xcode 自己生成下载；**或**
   - 导出已有「Developer ID Application」证书**连同私钥**为 `.p12`（设密码）发我导入
2. **Team ID**（10 位，如 `ABCDE12345`）
3. 一个正式 **bundle id**（现在是占位 `com.example.app`，换成 `com.<公司>.<应用>`）
4. **公证凭据**（分发到别人电脑才需要，本机自测不用），二选一：
   - App Store Connect **API Key**：`.p8` + `Key ID` + `Issuer ID`；**或**
   - 一个 Apple ID + 它的 **App 专用密码**

### 4.2 electron-builder.yml（启用正规签名 + 公证）

```yaml
appId: com.公司.应用              # ← 换成正式 bundle id
mac:
  hardenedRuntime: true          # 公证要求开（electron-builder 默认就是 true）
  entitlementsInherit: build/entitlements.mac.plist
  # identity 默认会自动从钥匙串找 "Developer ID Application"；多证书时显式写：
  # identity: "Developer ID Application: 公司名 (ABCDE12345)"
  notarize:                      # 用 App Store Connect API Key 公证
    teamId: ABCDE12345
# 或用环境变量喂凭据（更常见，见 4.3）
```

- 生产用 Developer ID 时**不需要** disable-library-validation：electron-builder 会把 Electron 框架也用你的证书重签，全部同一 Team ID，LV 自动通过
- `entitlements.mac.plist` 保留 Electron 需要的 `allow-jit` / `allow-unsigned-executable-memory` / `allow-dyld-environment-variables`

### 4.3 签名 + 公证 + 钉装（CI/本地通用）

```bash
# 证书：从 .p12 导入（CI 上常用环境变量）
export CSC_LINK="/path/to/DeveloperID.p12"      # 或 base64
export CSC_KEY_PASSWORD="p12 密码"

# 公证：API Key 三件套
export APPLE_API_KEY="/path/to/AuthKey_XXXX.p8"
export APPLE_API_KEY_ID="KEYID"
export APPLE_API_ISSUER="ISSUER-UUID"

pnpm -F app build:mac   # electron-builder 自动：签名 → 公证 → staple
```

- electron-builder 全自动跑完「签名 → 上传公证 → staple 钉装」
- 验证：`spctl -a -vvv -t install <app>` → 应显示 `accepted source=Notarized Developer ID`

### 4.4 为什么生产必须公证

别人电脑下载/拷贝你的 app 会带 `com.apple.quarantine` 隔离属性 → 首次打开触发 Gatekeeper 评估 → **没公证就被拦**。公证 = Apple 扫描盖章，Gatekeeper 才放行。**本机自己 build 的没隔离属性，所以本机不公证也能跑**（这就是 dev 顺、别人电脑卡的另一面）

---

## 5. 踩过的所有坑（速查）

| # | 坑 | 现象 | 解 |
|---|---|---|---|
| ① | 证书少 codeSigning EKU | codesign 不认 | `-addext extendedKeyUsage=codeSigning` |
| ② | openssl3 p12 没加 `-legacy` | macOS `security import` 读不了 | `openssl pkcs12 -export -legacy` |
| ③ | 钥匙串不在搜索列表 | `codesign: no identity found` | `security list-keychains -s` 加进去（带上原有的） |
| ④ | `CSSMERR_TP_NOT_TRUSTED` / `0 valid` | 看着像坏了 | **无害**，签名不查信任；只影响 Gatekeeper 和 electron-builder 的 `-v` |
| ⑤ | 重签带了 hardened runtime | 自签名无 Team ID → LV 崩溃 | 本机验证**不带** `--options runtime` |
| ⑥ | 授权后没重启 app | fn-listener 早已退出，仍无权限 | 改授权后**必须重启 app** |
| ⑦ | 从终端跑 `.../MacOS/electron-app` 测 | 借了终端授权，假象 | 用 `open` / Finder 双击测 |
| ⑧ | ad-hoc 每次 cdhash 变 | 「授权了也没用」反复出现 | **稳定签名身份**（本文核心） |
| ⑨ | 多份同名 `electron-app` | 系统设置挤成一条、绑乱 | 唯一 bundle id；删掉残留旧拷贝 |
| ⑩ | electron-builder 见非 Apple 证书 | `skipped code signing` | 预期行为，改用 `codesign` 手签（自签名场景） |
| ⑪ | 自签名拷到别人电脑 | Gatekeeper 拦「已损坏/身份不明」 | 分发必须 Developer ID + 公证 |

---

## 6. 日常重建工作流（删了重建后，权限自动沿用）

> 一句话：`build` 产物永远是 ad-hoc，**单跑 build 权限不会好**；必须再用同一个证书重签
> 但**只要证书和 bundle id 不变，DR 一字不差 → TCC 已授的辅助功能权限自动沿用，不用重新授权**

```bash
# 一次性（建过就不用再来；重启后钥匙串会锁，install 里已自动解锁）
bun scripts/selfsign-app.ts setup

# 以后每次「删掉重建 + 安装」：
pnpm -F app build:unpack                       # 构建（比 build:mac 快，不打 dmg）
bun scripts/selfsign-app.ts install           # 自动：拷到 ~/Applications + 签 Resources + 整包签 + 校验
```

| 要点 | 说明 |
|---|---|
| `dist/` 能不能删 | 能，纯构建产物，`rm -rf dist` 再 build 都行；`~/Applications` 那份独立不受影响 |
| 直接 `build:mac` 够吗 | 不够，产物是 ad-hoc，**必须接 `install` 重签**；本地循环用更快的 `build:unpack` |
| 重建后要重新授权吗 | **不用**。证书(`719e…`) + bundle id 没变 → DR 不变 → 旧授权自动生效 |
| 什么时候要重新授权 | 删了证书重 `setup`（换了证书根）/ 改了 `appId` 时，DR 变了才要重授一次 |
| 测哪个 | 只双击 `~/Applications/electron-app.app`，别碰 dist 里那个 ad-hoc 的 |
| 改证书名 | 改脚本顶部 `CERT_CN` 一处即可；名字只是标签，TCC 认的是证书哈希不是名字 |

---

## 7. 清理（验证完恢复环境）

> 当前状态：build 钥匙串 `local-codesign.keychain-db` **已加进搜索列表**、证书**还在**
> 验证期间**先别清**（还要反复重签测试）。测完再跑：

```bash
bun scripts/selfsign-app.ts cleanup
# 等价于：
#   security list-keychains -d user -s <把 local-codesign 去掉后的原列表>
#   security delete-keychain ~/Library/Keychains/local-codesign.keychain-db
#   rm -rf /tmp/localsign-codesign
```

- 清理**不影响**已签好的 `.app`（它仍能运行），只是**无法再重签**
- 没有改动系统信任库（全程没 `add-trusted-cert`），无需额外还原

---

## 8. 命令速查

```bash
# 看一个 app 的签名身份 + DR
codesign -dvvv <app> 2>&1 | grep -E "Identifier=|Authority=|Signature="
codesign -d --requirements - <app>

# 结构校验（不查信任）
codesign --verify --deep --verbose=2 <app>

# Gatekeeper / 公证状态（分发才看）
spctl -a -vvv -t install <app>

# 看隔离属性
xattr -p com.apple.quarantine <app> 2>/dev/null && echo "有隔离" || echo "无隔离"

# 看 TCC 授权（系统库只读，需 sudo）
sudo sqlite3 "/Library/Application Support/com.apple.TCC/TCC.db" \
  "SELECT service,client,client_type,auth_value FROM access WHERE service='kTCCServiceAccessibility';"

# 重置某 app 的辅助功能授权
tccutil reset Accessibility <bundle-id>
```
