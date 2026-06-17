# 权限测试

## macOS

macOS 权限由 TCC 管理。麦克风、屏幕录制、辅助功能等权限看的是“谁发起请求”，不是只看应用名称

### 先分清测试对象

| 场景 | 权限通常属于谁 |
|---|---|
| `pnpm -F app dev` | 启动 dev 的终端、Electron 开发运行时、原生 helper |
| 安装后的 `.app` | 应用自己的 bundle id |

所以开发模式下，权限可能要给 Terminal / iTerm / kitty / WezTerm / Electron，而不是最终 app id。最终分发验收仍然要安装签名后的 `.app` 再测

### 获取 app id

已安装 `.app`：

```bash
APP="/Applications/YourApp.app"
plutil -extract CFBundleIdentifier raw "$APP/Contents/Info.plist"
```

已被系统识别的 App：

```bash
osascript -e 'id of app "YourApp"'
```

项目里通常看 `electron-builder.yml` 的 `appId`

也可以用诊断脚本确认：

```bash
pnpm -F app diagnose:mac-permissions /Applications/YourApp.app
```

### 重置权限

重置某个 app id 的全部 TCC 记录：

```bash
tccutil reset All "com.example.app"
```

这会清空当前用户下 `com.example.app` 的麦克风、屏幕录制、辅助功能等权限记录；不会卸载 App，不会删除 App 数据，也不会影响终端、Electron 或其他 bundle id

只重置单项：

```bash
tccutil reset Microphone "com.example.app"
tccutil reset ScreenCapture "com.example.app"
tccutil reset Accessibility "com.example.app"
tccutil reset AudioCapture "com.example.app"
```

`AudioCapture` 不是所有 macOS 版本都支持，报错可以忽略

### 开发模式测试

如果用终端启动 dev，先查终端 bundle id：

```bash
osascript -e 'id of app "kitty"'
osascript -e 'id of app "WezTerm"'
osascript -e 'id of app "Terminal"'
osascript -e 'id of app "iTerm"'
```

重置对应终端：

```bash
tccutil reset All "net.kovidgoyal.kitty"
```

然后完全退出终端，重新打开并启动：

```bash
pnpm -F app dev
```

触发功能后，到 **系统设置** → **隐私与安全性** 检查权限到底落在哪个程序上

### 安装包验收

```bash
pnpm -F app build:mac:test
pnpm -F app diagnose:mac-permissions /Applications/YourApp.app
```

重点看：

- bundle id 是否正确
- 签名身份是否正确
- Gatekeeper / notarization 是否符合预期
- TCC 记录是否属于正确的 bundle id

### 分发渠道验收

正式测试不要从飞书、微信、企业网盘客户端等沙盒 App 直接下载 `.dmg`。这些客户端可能给文件打上 `AppSandbox` 来源标记，导致签名和公证都正确时仍被 Gatekeeper 拦截：

```text
File created by an AppSandbox, exec/open not allowed
```

推荐用浏览器从 HTTPS 链接下载，例如官网、对象存储、CDN 或 GitHub Release。下载后先检查来源：

```bash
DMG="$HOME/Downloads/YourApp.dmg"

xattr -p com.apple.quarantine "$DMG" 2>/dev/null || echo "no quarantine"
```

正常浏览器下载通常会显示 `Safari` 或 `Google Chrome`；如果显示 `Feishu`、`WeChat`、`AppSandbox` 等，不要用这份文件做首次安装验收。

完整验收命令：

```bash
DMG="$HOME/Downloads/YourApp.dmg"
EXPECTED_SHA256="替换为发布物 sha256"

ACTUAL_SHA256="$(shasum -a 256 "$DMG" | awk '{print $1}')"
echo "$ACTUAL_SHA256"

if [ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]; then
  echo "SHA256 不一致，文件可能被传输渠道改动"
  exit 1
fi

xattr -l "$DMG" || true
hdiutil verify "$DMG"
xcrun stapler validate "$DMG"

hdiutil detach "/Volumes/YourApp 1.0.0-arm64" 2>/dev/null || true
hdiutil attach -nobrowse -readonly "$DMG"

APP="$(find /Volumes -maxdepth 2 -name 'YourApp.app' -print -quit)"

codesign --verify --deep --strict --verbose=2 "$APP"
spctl --assess --type execute --verbose=4 "$APP"
```

通过标准：

```text
The validate action worked!
valid on disk
satisfies its Designated Requirement
accepted
source=Notarized Developer ID
```

如果测试机已经执行过 `xattr -cr /Applications/YourApp.app`，这份已安装 App 不能再用于“首次打开是否会被 Gatekeeper 拦截”的测试。需要删除 App，重新从正确渠道下载 `.dmg` 后再测。

### 常见现象

| 现象 | 常见原因 |
|---|---|
| 重置 app id 后仍不弹权限 | dev 模式实际权限给了终端或 Electron |
| 设置里显示有权限，但功能不可用 | 授权记录属于旧签名、旧 bundle id 或另一个进程 |
| `tccutil` 提示没有 bundle id | 这个 bundle id 没有 TCC 记录，或测试身份不是它 |
| 辅助功能授权后快捷键仍不可用 | 进程未重启，或实际监听者是 helper / 终端 |
| 麦克风没有 `+` 添加按钮 | 麦克风权限只能由 App 主动请求后进入列表 |
| 签名 / 公证都通过，但打不开 | 检查 `xattr -p com.apple.quarantine`，可能是沙盒客户端下载导致的 `AppSandbox` 来源 |
