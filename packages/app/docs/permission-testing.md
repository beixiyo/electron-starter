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
tccutil reset all "com.example.app"
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
tccutil reset all "net.kovidgoyal.kitty"
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

### 常见现象

| 现象 | 常见原因 |
|---|---|
| 重置 app id 后仍不弹权限 | dev 模式实际权限给了终端或 Electron |
| 设置里显示有权限，但功能不可用 | 授权记录属于旧签名、旧 bundle id 或另一个进程 |
| `tccutil` 提示没有 bundle id | 这个 bundle id 没有 TCC 记录，或测试身份不是它 |
| 辅助功能授权后快捷键仍不可用 | 进程未重启，或实际监听者是 helper / 终端 |
| 麦克风没有 `+` 添加按钮 | 麦克风权限只能由 App 主动请求后进入列表 |

