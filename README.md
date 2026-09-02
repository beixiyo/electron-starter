# Electron Mono-Repo 模板

## 系统要求

| 功能 | 最低 macOS 版本 | 说明 |
|------|----------------|------|
| 会议检测（audio-monitor） | 14.2 Sonoma | Core Audio Taps API |
| 录音 — 系统音频 | 14.0 | ScreenCaptureKit |
| 录音 — 麦克风 | **15.0** Sequoia | `SCStreamConfiguration.captureMicrophone` |

> Windows / Linux 不涉及 native 二进制，相关功能静默跳过

---

## Env 配置

https://cn.electron-vite.org/guide/env-and-mode

- `packages/app/env/.env.development`
- `packages/app/env/.env.production`

```bash
# Electron Env
VITE_ELECTRON_API_BASE_URL=xxx
VITE_ELECTRON_WS_BASE_URL=xxx

VITE_ELECTRON_APPLE_CLIENT_ID=xxx
# OAuth Center 的固定 HTTPS 回调地址，最终会跳回 xxx://oauth/complete
VITE_ELECTRON_APPLE_REDIRECT_URI=https://<oauth-center-domain>/callback/apple/desktop
VITE_ELECTRON_APPLE_SCOPE=xxx

VITE_ELECTRON_GOOGLE_CLIENT_ID=xxx
VITE_ELECTRON_GOOGLE_REDIRECT_URI=https://<oauth-center-domain>/callback/google/desktop


# Web Env
VITE_WEB_API_BASE_URL=xxx
VITE_WEB_WS_BASE_URL=xxx

VITE_WEB_APPLE_CLIENT_ID=xxx
VITE_WEB_APPLE_REDIRECT_URI=xxx
VITE_WEB_APPLE_SCOPE=xxx
VITE_WEB_APPLE_STATE=xxx

VITE_WEB_GOOGLE_CLIENT_ID=xxx
VITE_WEB_GOOGLE_REDIRECT_URI=xxx


# ASR Env
MAIN_VITE_ASR_APPID=xxx
MAIN_VITE_ASR_TOKEN=xxx
MAIN_VITE_ASR_CLUSTER=xxx
```

模板默认协议是 `xxx://`，同时定义在 `packages/app/shared/constants/app-protocol.ts`
和 `packages/app/electron-builder.yml`；创建实际项目时必须一起替换。OAuth Center 的
`DISPATCH_DESKTOP_BASE_URL` 也必须配置成同一个 scheme，例如 `xxx://`

---

## 启动开发

```bash
pnpm i
pnpm build

# macOS：编译 Swift native 二进制（audio-monitor / audio-recorder / screenshot-capture / fn-listener / focus-check / hour-cycle）
bash packages/app/scripts/build-native.sh

cd packages/app
pnpm dev
```

VSCode 开发直接按下 **F5**

---

## Native 二进制

`packages/app/resources/` 下有多个 Swift 源码，通过统一脚本编译为 Universal Binary（arm64 + x86_64）：

```bash
bash packages/app/scripts/build-native.sh
```

| 二进制 | 源码 | 功能 |
|--------|------|------|
| `audio-monitor` | `audio-monitor.swift` | 轮询 Core Audio，检测哪些进程正在使用音频设备 |
| `audio-recorder` | `audio-recorder.swift` | ScreenCaptureKit 录制系统音频 + 麦克风，stdin/stdout JSON 通信 |
| `fn-listener` | `fn-listener.swift` | 监听 Fn 键事件 |
| `focus-check` | `focus-check.swift` | 检查前台应用焦点状态 |
| `hour-cycle` | `main.swift` | 读取 macOS 当前生效的 12/24 小时制偏好 |
| `screenshot-capture` | `ScreenshotCapture.swift` | ScreenCaptureKit 单帧原图捕获 |

常驻二进制通过 `NativeBridge` 管理生命周期；一次性 helper（如 `screenshot-capture`）由主进程按需执行。

> 产物（无扩展名的二进制文件）已在 `.gitignore` 中排除，每次拉取后需重新编译

---

## 错误排查

### node-gyp: `No module named 'distutils'`

Python 3.12+ 移除了内置的 `distutils` 模块，导致旧版 `node-gyp`（如 `@electron/rebuild` 内置的 v9.x）编译原生模块时报错：

```
ModuleNotFoundError: No module named 'distutils'
```

**修复方式**（按系统选择）：

```bash
# macOS (Homebrew)
brew install python-setuptools

# 其他系统
pip3 install setuptools
```

---

### Arch Linux: `libcrypt.so.1` 缺失（仅 electron-builder 26+）

electron-builder 26+ 内置的 fpm（Ruby 预编译）依赖 `libcrypt.so.1`，但 Arch Linux 已升级为 `libcrypt.so.2`，导致 deb/snap 打包失败：

```
ruby: error while loading shared libraries: libcrypt.so.1: cannot open shared object file
```

**修复**：安装兼容库（Arch 官方 core 仓库）：

```bash
sudo pacman -S libxcrypt-compat
```

> **注意**：electron-builder 25.x 使用旧版 fpm，不受此问题影响。

### electron-builder 26 + pnpm monorepo: `Cannot find module`

electron-builder v26 重写了模块收集器（纯 JS 替代旧 `app-builder` 二进制），对 pnpm monorepo 的 symlink 结构支持存在**已知 bug**（[#8986](https://github.com/electron-userland/electron-builder/issues/8986)、[#9654](https://github.com/electron-userland/electron-builder/issues/9654)），导致 ASAR 中缺失 node_modules，运行时报错：

```
Error: Cannot find module '@electron-toolkit/utils'
Error: Cannot find module 'uiohook-napi'
```

**修复**：降级到 electron-builder **25.1.8**（旧收集器能正确跟踪 pnpm symlink）：

```bash
pnpm -F app add -D electron-builder@25.1.8
```

---

## 打包

```bash
# 打包产物在 packages/app/dist/dist
pnpm -F app build:win
pnpm -F app build:mac
pnpm -F app build:linux
```
